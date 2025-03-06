<?php
/**
 * WebSender PHP İstemci Kütüphanesi
 * 
 * Bu kütüphane, WebSender API'sine WebSocket üzerinden bağlanmayı ve
 * RSA tabanlı kimlik doğrulamayı sağlar.
 * 
 * Gereksinimler:
 * - PHP 7.3+
 * - OpenSSL Extension
 * - WebSocket istemcisi için "textalk/websocket" paketi
 *   Kurulum: composer require textalk/websocket
 * 
 * @author BlokDiyari
 * @version 1.0.0
 */

/**
 * CWebSender API İstemci Sınıfı
 */
class CWebSenderClient {
    /**
     * WebSocket sunucu URL'si
     * @var string
     */
    private $serverUrl;
    
    /**
     * Yapılandırma ayarları
     * @var array
     */
    private $config;
    
    /**
     * WebSocket bağlantısı
     * @var WebSocket\Client
     */
    private $ws = null;
    
    /**
     * Private key
     * @var string
     */
    private $privateKey = null;
    
    /**
     * Mesaj ID sayacı
     * @var int
     */
    private $messageIdCounter = 1;
    
    /**
     * Yanıt bekleyen Promise'ler
     * @var array
     */
    private $responsePromises = [];
    
    /**
     * Kimlik doğrulama durumu
     * @var bool
     */
    private $authenticated = false;
    
    /**
     * Yeniden bağlanma deneme sayısı
     * @var int
     */
    private $reconnectAttempts = 0;
    
    /**
     * Son aktivite zamanı
     * @var int
     */
    private $lastActivity = 0;
    
    /**
     * Ping timer
     * @var resource
     */
    private $pingTimer = null;
    
    /**
     * Ping timeout
     * @var resource
     */
    private $pingTimeout = null;
    
    /**
     * Event listener'lar
     * @var array
     */
    private $eventListeners = [];
    
    /**
     * Nonce değeri
     * @var string
     */
    private $currentNonce = null;
    
    /**
     * Public key (sunucudan alınır)
     * @var string
     */
    private $serverPublicKey = null;
    
    /**
     * Constructor
     * 
     * @param string|array $config WebSocket URL'si veya yapılandırma dizisi
     * @param array $options Bağlantı seçenekleri (config bir string ise)
     */
    public function __construct($config, $options = []) {
        // Config bir string ise (URL olarak verilmiş)
        if (is_string($config)) {
            $this->serverUrl = $config;
            $this->config = $options ?: [];
        } else {
            $this->serverUrl = $config['serverUrl'];
            $this->config = $config;
        }
        
        // Varsayılan değerler
        $this->config['timeout'] = $this->config['timeout'] ?? 30000;
        $this->config['reconnect'] = $this->config['reconnect'] ?? true;
        $this->config['reconnectInterval'] = $this->config['reconnectInterval'] ?? 5000;
        $this->config['maxReconnects'] = $this->config['maxReconnects'] ?? 10;
        $this->config['pingInterval'] = $this->config['pingInterval'] ?? 30000;
        
        $this->lastActivity = time() * 1000;
        
        // Event listener'ları başlat
        $this->eventListeners = [
            'open' => [],
            'close' => [],
            'error' => [],
            'auth_success' => [],
            'auth_failure' => [],
            'player_join' => [],
            'player_quit' => [],
            'command_executed' => []
        ];
    }
    
    /**
     * WebSocket sunucusuna bağlan
     * 
     * @return bool Bağlantı başarılı ise true
     * @throws Exception Bağlantı hatası
     */
    public function connect() {
        try {
            // Önceki bağlantıyı kapat
            if ($this->ws !== null) {
                try {
                    $this->ws->close();
                } catch (Exception $closeError) {
                    error_log("CWebSenderClient: Önceki bağlantı kapatılırken hata: " . $closeError->getMessage());
                }
            }
            
            // Private key'i yükle
            try {
                $this->loadPrivateKey();
            } catch (Exception $keyError) {
                error_log("CWebSenderClient: Private key yükleme hatası: " . $keyError->getMessage());
                throw new Exception("Private key yükleme hatası: " . $keyError->getMessage());
            }
            
            error_log("CWebSenderClient: {$this->serverUrl} adresine bağlanılıyor...");
            
            // WebSocket bağlantısı kur
            try {
                $this->ws = new \WebSocket\Client($this->serverUrl, [
                    'timeout' => $this->config['timeout'] / 1000, // WebSocket client saniye bekliyor
                    'context' => stream_context_create([
                        'ssl' => [
                            'verify_peer' => false,
                            'verify_peer_name' => false
                        ]
                    ])
                ]);
                
                error_log("CWebSenderClient: Bağlantı açıldı");
                $this->reconnectAttempts = 0;
                $this->lastActivity = time() * 1000;
                
                // Event listener'ları çağır
                $this->triggerEvent('open');
                
                // Bağlantı açıldıktan sonra mesajları dinle
                $this->startMessageListener();
                
                // Kimlik doğrulama
                if ($this->authenticate()) {
                    // Ping-pong mekanizmasını başlat
                    $this->startPingPong();
                    return true;
                } else {
                    throw new Exception("Kimlik doğrulama başarısız");
                }
                
            } catch (Exception $wsError) {
                error_log("CWebSenderClient: WebSocket oluşturulurken hata: " . $wsError->getMessage());
                $this->triggerEvent('error', ['message' => $wsError->getMessage()]);
                throw new Exception("WebSocket oluşturulurken hata: " . $wsError->getMessage());
            }
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Bağlantı kurulurken hata: " . $error->getMessage());
            throw $error;
        }
    }
    
    /**
     * Mesaj dinleyici thread'ini başlat (bu metod basitleştirilmiştir, gerçek uygulamada
     * event loop veya multi-threading kullanmanız gerekebilir)
     */
    private function startMessageListener() {
        // PHP'de WebSocket dinlemesi asenkron değildir, bu yüzden 
        // gerçek uygulamada ayrı bir process veya thread kullanmalısınız
        // Bu örnek, sizin kendi uygulama yapınıza entegre etmeniz gereken
        // basitleştirilmiş bir gösterimdir
        
        // Örnek: Mesaj almak için bir fonksiyon
        try {
            // İlk mesajı al (genellikle auth challenge)
            $data = $this->ws->receive();
            if ($data) {
                $message = json_decode($data, true);
                $this->handleMessage($message);
            }
        } catch (Exception $e) {
            error_log("CWebSenderClient: Mesaj dinlerken hata: " . $e->getMessage());
            $this->triggerEvent('error', ['message' => $e->getMessage()]);
        }
    }
    
    /**
     * Kimlik doğrulama işlemi
     * 
     * @return bool Kimlik doğrulama başarılı ise true
     */
    private function authenticate() {
        try {
            error_log("CWebSenderClient: Kimlik doğrulama bekleniyor...");
            
            // Authentication challenge için bekleyin
            // Not: Bu örnek beklemeyi basitleştirmek için bir kere mesaj alıyor
            // Gerçek uygulamada bir event loop veya daha karmaşık bir mekanizma kullanın
            for ($i = 0; $i < 10; $i++) {
                // Gelen mesajları kontrol et, auth challenge mesajını bekle
                try {
                    $data = $this->ws->receive();
                    if ($data) {
                        $message = json_decode($data, true);
                        if (isset($message['type']) && $message['type'] === 'authChallenge') {
                            // Auth challenge işle
                            $this->handleAuthChallenge($message);
                            
                            // Auth response bekle
                            for ($j = 0; $j < 10; $j++) {
                                $data = $this->ws->receive();
                                if ($data) {
                                    $response = json_decode($data, true);
                                    if (isset($response['type']) && $response['type'] === 'authResponse') {
                                        // Auth response işle
                                        if ($this->handleAuthResponse($response)) {
                                            return true;
                                        } else {
                                            return false;
                                        }
                                    }
                                }
                                // Kısa bir süre bekle
                                usleep(100000); // 100ms bekle
                            }
                        }
                    }
                } catch (Exception $e) {
                    error_log("CWebSenderClient: Auth mesajı beklerken hata: " . $e->getMessage());
                }
                
                // Kısa bir süre bekle
                usleep(200000); // 200ms bekle
            }
            
            error_log("CWebSenderClient: Kimlik doğrulama zaman aşımına uğradı");
            return false;
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Kimlik doğrulama hatası: " . $error->getMessage());
            return false;
        }
    }
    
    /**
     * Private key'i yükle
     */
    private function loadPrivateKey() {
        try {
            // Private key doğrudan verilmiş mi?
            if (isset($this->config['privateKey'])) {
                $this->privateKey = $this->config['privateKey'];
                error_log("CWebSenderClient: Private key yapılandırmadan yüklendi");
            } 
            // Private key dosya yolu verilmiş mi?
            else if (isset($this->config['privateKeyPath'])) {
                try {
                    // Dosyadan oku
                    $this->privateKey = file_get_contents($this->config['privateKeyPath']);
                    error_log("CWebSenderClient: Private key dosyadan okundu");
                } catch (Exception $error) {
                    error_log("CWebSenderClient: Private key dosyası okunamadı: " . $error->getMessage());
                    throw new Exception("Private key dosyası okunamadı: " . $error->getMessage());
                }
            } else {
                error_log("CWebSenderClient: Private key belirtilmemiş, kimlik doğrulama yapılamayabilir");
            }
            
            // Private key formatını kontrol et ve düzelt
            if ($this->privateKey) {
                // PKCS#1 formatını kontrol et (BEGIN RSA PRIVATE KEY)
                if (strpos($this->privateKey, '-----BEGIN RSA PRIVATE KEY-----') !== false && 
                    strpos($this->privateKey, '-----BEGIN PRIVATE KEY-----') === false) {
                    error_log("CWebSenderClient: PKCS#1 formatında private key tespit edildi");
                } 
                // PKCS#8 formatını kontrol et (BEGIN PRIVATE KEY)
                else if (strpos($this->privateKey, '-----BEGIN PRIVATE KEY-----') !== false) {
                    error_log("CWebSenderClient: PKCS#8 formatında private key tespit edildi");
                } 
                // Hiçbir başlık yoksa, muhtemelen düz içerik veya Base64
                else if (strpos($this->privateKey, '-----BEGIN') === false) {
                    // Base64 formatında olup olmadığını kontrol et
                    if (preg_match('/^[A-Za-z0-9+\/=]+$/', trim($this->privateKey))) {
                        error_log("CWebSenderClient: Base64 formatında private key tespit edildi");
                        // Base64 formatını koru, signNonce içinde dönüştürülecek
                    } else {
                        error_log("CWebSenderClient: Başlıksız private key tespit edildi, PKCS#8 formatına dönüştürülüyor");
                        // Düz içeriği PKCS#8 formatına dönüştür
                        $this->privateKey = "-----BEGIN PRIVATE KEY-----\n" . $this->privateKey . "\n-----END PRIVATE KEY-----";
                    }
                }
            }
        } catch (Exception $error) {
            error_log("CWebSenderClient: Private key yükleme hatası: " . $error->getMessage());
            throw $error;
        }
    }
    
    /**
     * Gelen mesajı işle
     * 
     * @param array $message Gelen mesaj
     */
    private function handleMessage($message) {
        try {
            // Mesaj formatını kontrol et
            if (empty($message)) {
                error_log("CWebSenderClient: Boş mesaj alındı");
                return;
            }
            
            if (!isset($message['type'])) {
                error_log("CWebSenderClient: Geçersiz mesaj formatı (tip eksik)");
                return;
            }
            
            // Her mesaj alındığında son aktivite zamanını güncelle
            $this->lastActivity = time() * 1000;
            
            // Mesaj türüne göre işlem yap
            switch ($message['type']) {
                case 'error':
                    error_log("CWebSenderClient: Sunucudan hata: " . ($message['message'] ?? 'Bilinmeyen hata'));
                    $this->triggerEvent('error', ['message' => $message['message'] ?? 'Bilinmeyen hata']);
                    break;
                    
                case 'ping':
                    // Ping mesajına pong ile yanıt ver
                    $this->sendMessage(['type' => 'pong']);
                    break;
                    
                case 'pong':
                    // Sunucudan pong yanıtı geldi, bağlantı aktif
                    $this->lastActivity = time() * 1000;
                    break;
                    
                case 'authChallenge':
                    // Kimlik doğrulama challenge'ı
                    $this->handleAuthChallenge($message);
                    break;
                    
                case 'authResponse':
                    // Kimlik doğrulama yanıtı
                    $this->handleAuthResponse($message);
                    break;
                    
                // Sunucudan gelen yanıt tipleri
                case 'commandResponse':
                case 'placeholderResponse':
                case 'playerOnlineResponse':
                case 'onlinePlayersResponse':
                case 'broadcastResponse':
                case 'playerMessageResponse':
                case 'serverInfoResponse':
                    // Yanıt mesajı
                    if (isset($message['id']) && isset($this->responsePromises[$message['id']])) {
                        $promiseData = $this->responsePromises[$message['id']];
                        unset($this->responsePromises[$message['id']]);
                        
                        if (isset($message['error'])) {
                            error_log("CWebSenderClient: {$message['type']} yanıtında hata: " . $message['error']);
                            // PHP'de Promise konsepti doğrudan yok, bu yüzden burada callback yaklaşımı kullanıyoruz
                            if (isset($promiseData['reject'])) {
                                call_user_func($promiseData['reject'], $message['error']);
                            }
                        } else {
                            if (isset($promiseData['resolve'])) {
                                call_user_func($promiseData['resolve'], $message);
                            }
                        }
                    } else if (isset($message['id'])) {
                        error_log("CWebSenderClient: Bilinmeyen ID ile yanıt alındı: " . $message['id'] . ", tip: " . $message['type']);
                    } else {
                        error_log("CWebSenderClient: ID'siz yanıt alındı: " . $message['type']);
                    }
                    break;
                    
                default:
                    error_log("CWebSenderClient: Bilinmeyen mesaj türü: " . $message['type']);
            }
        } catch (Exception $error) {
            error_log("CWebSenderClient: Mesaj işleme hatası: " . $error->getMessage());
        }
    }
    
    /**
     * Kimlik doğrulama challenge'ını işle
     * 
     * @param array $message Auth challenge mesajı
     */
    private function handleAuthChallenge($message) {
        try {
            if (!isset($message['nonce']) || !isset($message['publicKey'])) {
                error_log("CWebSenderClient: Geçersiz auth challenge formatı");
                $this->triggerEvent('auth_failure', "Geçersiz auth challenge formatı");
                return;
            }
            
            $this->currentNonce = $message['nonce'];
            $this->serverPublicKey = $message['publicKey'];
            
            error_log("CWebSenderClient: Auth challenge alındı, nonce: " . $this->currentNonce);
            
            // Nonce'u imzala ve yanıt gönder
            $signature = $this->signNonce($this->currentNonce);
            
            if (!$signature) {
                error_log("CWebSenderClient: Nonce imzalama hatası");
                $this->triggerEvent('auth_failure', "Nonce imzalama hatası");
                return;
            }
            
            // Auth yanıtı gönder
            $this->sendMessage([
                'type' => 'authResponse',
                'nonce' => $this->currentNonce,
                'signature' => $signature
            ]);
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Auth challenge işleme hatası: " . $error->getMessage());
            $this->triggerEvent('auth_failure', $error->getMessage());
        }
    }
    
    /**
     * Kimlik doğrulama yanıtını işle
     * 
     * @param array $message Auth response mesajı
     * @return bool Kimlik doğrulama başarılı ise true
     */
    private function handleAuthResponse($message) {
        try {
            if (!isset($message['status'])) {
                error_log("CWebSenderClient: Geçersiz auth response formatı");
                $this->triggerEvent('auth_failure', "Geçersiz auth response formatı");
                return false;
            }
            
            if ($message['status'] === 'success') {
                error_log("CWebSenderClient: Kimlik doğrulama başarılı");
                $this->authenticated = true;
                $this->triggerEvent('auth_success');
                return true;
            } else {
                $errorMessage = $message['message'] ?? "Kimlik doğrulama başarısız";
                error_log("CWebSenderClient: Kimlik doğrulama başarısız: " . $errorMessage);
                $this->authenticated = false;
                $this->triggerEvent('auth_failure', $errorMessage);
                return false;
            }
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Auth response işleme hatası: " . $error->getMessage());
            $this->triggerEvent('auth_failure', $error->getMessage());
            return false;
        }
    }
    
    /**
     * Nonce'u imzala
     * 
     * @param string $nonce İmzalanacak nonce
     * @return string Base64 formatında imza
     */
    private function signNonce($nonce) {
        try {
            if (!$this->privateKey) {
                error_log("CWebSenderClient: Private key mevcut değil, imzalama yapılamıyor");
                return null;
            }
            
            $signature = null;
            $result = openssl_sign($nonce, $signature, $this->privateKey, OPENSSL_ALGO_SHA256);
            
            if (!$result || !$signature) {
                error_log("CWebSenderClient: Nonce imzalama başarısız");
                return null;
            }
            
            // İmzayı Base64 formatına dönüştür
            return base64_encode($signature);
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Nonce imzalama hatası: " . $error->getMessage());
            return null;
        }
    }
    
    /**
     * Ping-pong mekanizmasını başlat
     */
    private function startPingPong() {
        // PHP'de asenkron zamanlayıcılar için farklı bir yaklaşım gerekir
        // Bu örnek, sizin kendi uygulama yapınıza entegre etmeniz gereken bir prototiptir
        
        // Her pingInterval sürede bir ping gönder
        // Gerçek uygulamada bu iş için ayrı bir thread veya
        // pcntl_fork() ile ayrı bir process kullanabilirsiniz
        
        // Örnek ping gönderimi
        $this->sendMessage(['type' => 'ping']);
    }
    
    /**
     * Ping-pong mekanizmasını durdur
     */
    private function stopPingPong() {
        // PHP'de asyncio olmadığı için bu örnek basittir
        // Gerçek uygulamada thread veya process temelli yaklaşım kullanmanız gerekir
    }
    
    /**
     * İstek gönder ve yanıt bekle
     * 
     * @param array $message İstek mesajı
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     * @param int $timeout Zaman aşımı (ms)
     */
    public function sendRequest($message, $resolve = null, $reject = null, $timeout = null) {
        try {
            if (!$this->authenticated) {
                if ($reject) {
                    call_user_func($reject, "Kimlik doğrulaması yapılmamış");
                }
                return;
            }
            
            $messageId = $this->generateMessageId();
            $message['id'] = $messageId;
            
            // Yanıt Promise'ini kaydet
            $this->responsePromises[$messageId] = [
                'resolve' => $resolve,
                'reject' => $reject,
                'timestamp' => time() * 1000
            ];
            
            // İsteği gönder
            $this->sendMessage($message);
            
            // Yanıt bekleyen mantığı uygulayın
            // Bu örnek basitleştirilmiştir, asenkron mantık gerektirir
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: İstek gönderme hatası: " . $error->getMessage());
            if ($reject) {
                call_user_func($reject, $error->getMessage());
            }
        }
    }
    
    /**
     * Mesaj gönder
     * 
     * @param array $message Gönderilecek mesaj
     * @return bool Başarıyla gönderildi ise true
     */
    private function sendMessage($message) {
        try {
            if ($this->ws === null || !$this->ws) {
                error_log("CWebSenderClient: WebSocket bağlantısı mevcut değil");
                return false;
            }
            
            // Mesajı JSON'a dönüştür
            $jsonMessage = json_encode($message);
            if ($jsonMessage === false) {
                error_log("CWebSenderClient: JSON dönüştürme hatası: " . json_last_error_msg());
                return false;
            }
            
            // Mesajı gönder
            $this->ws->send($jsonMessage);
            
            // Son aktivite zamanını güncelle
            $this->lastActivity = time() * 1000;
            return true;
            
        } catch (Exception $error) {
            error_log("CWebSenderClient: Mesaj gönderme hatası: " . $error->getMessage());
            return false;
        }
    }
    
    /**
     * Benzersiz mesaj ID'si oluştur
     * 
     * @return string Mesaj ID'si
     */
    private function generateMessageId() {
        return uniqid() . '-' . $this->messageIdCounter++;
    }
    
    /**
     * Event tetikle
     * 
     * @param string $event Event adı
     * @param mixed $data Event verisi
     */
    private function triggerEvent($event, $data = null) {
        if (!isset($this->eventListeners[$event])) {
            return;
        }
        
        foreach ($this->eventListeners[$event] as $callback) {
            call_user_func($callback, $data);
        }
    }
    
    /**
     * Event listener ekle
     * 
     * @param string $event Event adı
     * @param callable $callback Callback fonksiyonu
     */
    public function on($event, $callback) {
        if (!isset($this->eventListeners[$event])) {
            $this->eventListeners[$event] = [];
        }
        
        $this->eventListeners[$event][] = $callback;
    }
    
    /**
     * Event listener kaldır
     * 
     * @param string $event Event adı
     * @param callable $callback Kaldırılacak callback
     */
    public function off($event, $callback) {
        if (!isset($this->eventListeners[$event])) {
            return;
        }
        
        $index = array_search($callback, $this->eventListeners[$event], true);
        if ($index !== false) {
            array_splice($this->eventListeners[$event], $index, 1);
        }
    }
    
    /**
     * Tüm event listener'ları kaldır
     * 
     * @param string $event Event adı (belirtilmezse tüm event'ler için)
     */
    public function removeAllListeners($event = null) {
        if ($event !== null) {
            if (isset($this->eventListeners[$event])) {
                $this->eventListeners[$event] = [];
            }
        } else {
            foreach ($this->eventListeners as $event => $listeners) {
                $this->eventListeners[$event] = [];
            }
        }
    }
    
    /**
     * Bağlantıyı kapat
     */
    public function disconnect() {
        $this->stopPingPong();
        
        if ($this->ws !== null) {
            try {
                $this->ws->close();
                $this->ws = null;
                $this->authenticated = false;
                error_log("CWebSenderClient: Bağlantı kapatıldı");
                $this->triggerEvent('close', ['code' => 1000, 'reason' => 'Kullanıcı tarafından kapatıldı']);
            } catch (Exception $error) {
                error_log("CWebSenderClient: Bağlantı kapatılırken hata: " . $error->getMessage());
            }
        }
    }
    
    /**
     * Komut çalıştır
     * 
     * @param string $command Çalıştırılacak komut
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     */
    public function executeCommand($command, $resolve = null, $reject = null) {
        $this->sendRequest([
            'type' => 'command',
            'command' => $command
        ], $resolve, $reject);
    }
    
    /**
     * Placeholder değerini al
     * 
     * @param string $placeholder Placeholder
     * @param string $player Oyuncu adı (opsiyonel)
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     */
    public function parsePlaceholder($placeholder, $player = null, $resolve = null, $reject = null) {
        $request = [
            'type' => 'placeholder',
            'placeholder' => $placeholder
        ];
        
        if ($player) {
            $request['player'] = $player;
        }
        
        $this->sendRequest($request, $resolve, $reject);
    }
    
    /**
     * Oyuncunun çevrimiçi olup olmadığını kontrol et
     * 
     * @param string $player Oyuncu adı
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     */
    public function isPlayerOnline($player, $resolve = null, $reject = null) {
        $this->sendRequest([
            'type' => 'isPlayerOnline',
            'player' => $player
        ], $resolve, $reject);
    }
    
    /**
     * Çevrimiçi oyuncuları al
     * 
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     */
    public function getOnlinePlayers($resolve = null, $reject = null) {
        $this->sendRequest([
            'type' => 'getOnlinePlayers'
        ], $resolve, $reject);
    }
    
    /**
     * Sunucu bilgilerini al
     * 
     * @param callable $resolve Başarılı yanıt callback'i
     * @param callable $reject Hata yanıt callback'i
     */
    public function getServerInfo($resolve = null, $reject = null) {
        $this->sendRequest([
            'type' => 'getServerInfo'
        ], $resolve, $reject);
    }
}
?> 