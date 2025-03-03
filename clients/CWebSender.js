/**
 * WebSender JavaScript İstemci Kütüphanesi
 * 
 * Bu kütüphane, WebSender API'sine WebSocket üzerinden bağlanmayı ve
 * JWT token tabanlı kimlik doğrulamayı sağlar.
 * 
 * @author BlokDiyari
 * @version 1.0.0
 */

// Node.js için gerekli modüller
let WebSocket, crypto, fs;
if (typeof window === 'undefined') {
    WebSocket = require('ws');
    crypto = require('crypto');
    fs = require('fs');
}

/**
 * WebSender API istemci sınıfı
 */
class CWebSenderClient {
    /**
     * CWebSenderClient constructor
     * 
     * @param {string|Object} config - WebSocket URL'si veya yapılandırma nesnesi
     * @param {Object} options - Bağlantı seçenekleri (config bir string ise)
     */
    constructor(config, options = {}) {
        // Config bir string ise (URL olarak verilmiş)
        if (typeof config === 'string') {
            this.serverUrl = config;
            this.config = options || {};
        } else {
            this.serverUrl = config.serverUrl;
            this.config = config;
        }

        // Varsayılan değerler
        this.config.timeout = this.config.timeout || 30000;
        this.config.reconnect = this.config.reconnect !== false;
        this.config.reconnectInterval = this.config.reconnectInterval || 5000;
        this.config.maxReconnects = this.config.maxReconnects || 10;
        this.config.pingInterval = this.config.pingInterval || 30000; // 30 saniyede bir ping gönder

        // WebSocket ve durum değişkenleri
        this.ws = null;
        this.privateKey = null;
        this.messageIdCounter = 1;
        this.responsePromises = new Map();
        this.authenticated = false;
        this.reconnectAttempts = 0;
        this.lastActivity = Date.now();
        this.pingTimer = null;
        this.pingTimeout = null;
        
        // Event listener'lar
        this.eventListeners = {
            'open': [],
            'close': [],
            'error': [],
            'auth_success': [],
            'auth_failure': [],
            'player_join': [],
            'player_quit': [],
            'command_executed': []
        };
    }

    /**
     * WebSocket sunucusuna bağlan
     * @returns {Promise} Bağlantı kurulduğunda resolve olan Promise
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                // Önceki bağlantıyı kapat
                if (this.ws) {
                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn('CWebSenderClient: Önceki bağlantı kapatılırken hata:', closeError.message);
                    }
                    
                    // Önceki bağlantının tamamen kapanması için kısa bir bekleme
                    setTimeout(() => this._initConnection(resolve, reject), 1000);
                } else {
                    this._initConnection(resolve, reject);
                }
            } catch (error) {
                console.error('CWebSenderClient: Bağlantı kurulurken hata:', error.message);
                reject(error);
            }
        });
    }

    /**
     * WebSocket bağlantısını başlat
     * @param {Function} resolve - Promise resolve fonksiyonu
     * @param {Function} reject - Promise reject fonksiyonu
     * @private
     */
    _initConnection(resolve, reject) {
        try {
            // Private key'i yükle
            try {
                this._loadPrivateKey();
            } catch (keyError) {
                console.error('CWebSenderClient: Private key yükleme hatası:', keyError.message);
                return reject(new Error('Private key yükleme hatası: ' + keyError.message));
            }
            
            console.log(`CWebSenderClient: ${this.serverUrl} adresine bağlanılıyor...`);
            
            // WebSocket bağlantısı kur
            try {
                this.ws = new WebSocket(this.serverUrl);
            } catch (wsError) {
                console.error('CWebSenderClient: WebSocket oluşturulurken hata:', wsError.message);
                return reject(new Error('WebSocket oluşturulurken hata: ' + wsError.message));
            }
            
            // Bağlantı zaman aşımı
            const connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                    console.error('CWebSenderClient: Bağlantı zaman aşımına uğradı');
                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn('CWebSenderClient: Bağlantı kapatılırken hata:', closeError.message);
                    }
                    reject(new Error('Bağlantı zaman aşımına uğradı'));
                }
            }, this.config.timeout);
            
            // Bağlantı açıldığında
            this.ws.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('CWebSenderClient: Bağlantı açıldı');
                this.reconnectAttempts = 0;
                this.lastActivity = Date.now();
                
                // Event listener'ları çağır
                this._triggerEvent('open');
                
                // Kimlik doğrulama
                this._authenticate()
                    .then(() => {
                        // Ping-pong mekanizmasını başlat
                        this._startPingPong();
                        resolve();
                    })
                    .catch(error => {
                        console.error('CWebSenderClient: Kimlik doğrulama başarısız:', error.message);
                        try {
                            this.ws.close();
                        } catch (closeError) {
                            console.warn('CWebSenderClient: Bağlantı kapatılırken hata:', closeError.message);
                        }
                        reject(error);
                    });
            };
            
            // Bağlantı kapandığında
            this.ws.onclose = (event) => {
                clearTimeout(connectionTimeout);
                this.authenticated = false;
                
                // Ping-pong mekanizmasını durdur
                this._stopPingPong();
                
                // Hata koduna göre özel mesajlar
                let closeReason = event.reason || 'Belirtilmemiş';
                if (event.code === 1005) {
                    closeReason = 'Sunucu tarafından beklenmedik şekilde kapatıldı (1005)';
                } else if (event.code === 1006) {
                    closeReason = 'Bağlantı anormal şekilde kapandı (1006)';
                } else if (event.code === 1001) {
                    closeReason = 'Sunucu kapanıyor (1001)';
                }
                
                console.log(`CWebSenderClient: Bağlantı kapandı, kod: ${event.code}, neden: ${closeReason}`);
                this._triggerEvent('close', { code: event.code, reason: closeReason });
                
                // Otomatik yeniden bağlanma
                if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnects) {
                    // 1005 ve 1006 hata kodları için daha uzun bekleme süresi
                    let multiplier = 1;
                    if (event.code === 1005 || event.code === 1006) {
                        multiplier = 2; // Daha uzun bekle
                    }
                    
                    this.reconnectAttempts++;
                    const delay = this.config.reconnectInterval * Math.min(this.reconnectAttempts, 10) * multiplier;
                    console.log(`CWebSenderClient: ${delay}ms sonra yeniden bağlanılacak (${this.reconnectAttempts}/${this.config.maxReconnects})`);
                    
                    setTimeout(() => {
                        this.connect().catch(error => {
                            console.error('CWebSenderClient: Yeniden bağlanma hatası:', error.message);
                        });
                    }, delay);
                } else if (this.reconnectAttempts >= this.config.maxReconnects) {
                    console.error(`CWebSenderClient: Maksimum yeniden bağlanma denemesi aşıldı (${this.config.maxReconnects})`);
                }
            };
            
            // Bağlantı hatası
            this.ws.onerror = (error) => {
                // WebSocket hatası genellikle detaylı bilgi içermez, bu yüzden genel bir mesaj kullanıyoruz
                const errorMessage = 'WebSocket bağlantı hatası';
                console.error('CWebSenderClient: Bağlantı hatası:', errorMessage);
                this._triggerEvent('error', { message: errorMessage });
                
                // Hata durumunda bağlantıyı kapatmaya çalış
                if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn('CWebSenderClient: Hata sonrası bağlantı kapatılırken hata:', closeError.message);
                    }
                }
            };
            
            // Mesaj alındığında
            this.ws.onmessage = (event) => {
                this.lastActivity = Date.now();
                try {
                    const message = JSON.parse(event.data);
                    this._handleMessage(message);
                } catch (error) {
                    console.error('CWebSenderClient: Mesaj işleme hatası:', error.message);
                }
            };
            
        } catch (error) {
            console.error('CWebSenderClient: Bağlantı kurulurken hata:', error.message);
            reject(error);
        }
    }

    /**
     * Kimlik doğrulama işlemi
     * @returns {Promise} Kimlik doğrulama tamamlandığında resolve olan Promise
     * @private
     */
    _authenticate() {
        return new Promise((resolve, reject) => {
            try {
                console.log('CWebSenderClient: Kimlik doğrulama bekleniyor...');
                
                // Kimlik doğrulama zaman aşımı
                const authTimeout = setTimeout(() => {
                    // Event listener'ları temizle
                    const successIndex = this.eventListeners.auth_success.indexOf(authSuccessHandler);
                    if (successIndex !== -1) {
                        this.eventListeners.auth_success.splice(successIndex, 1);
                    }
                    
                    const failureIndex = this.eventListeners.auth_failure.indexOf(authFailureHandler);
                    if (failureIndex !== -1) {
                        this.eventListeners.auth_failure.splice(failureIndex, 1);
                    }
                    
                    this.authenticated = false;
                    reject(new Error(`Kimlik doğrulama zaman aşımına uğradı (${this.config.timeout}ms)`));
                }, this.config.timeout);
                
                // Kimlik doğrulama başarılı olduğunda
                const authSuccessHandler = () => {
                    clearTimeout(authTimeout);
                    
                    // Event listener'ları temizle
                    const successIndex = this.eventListeners.auth_success.indexOf(authSuccessHandler);
                    if (successIndex !== -1) {
                        this.eventListeners.auth_success.splice(successIndex, 1);
                    }
                    
                    const failureIndex = this.eventListeners.auth_failure.indexOf(authFailureHandler);
                    if (failureIndex !== -1) {
                        this.eventListeners.auth_failure.splice(failureIndex, 1);
                    }
                    
                    resolve();
                };
                
                // Kimlik doğrulama başarısız olduğunda
                const authFailureHandler = (error) => {
                    clearTimeout(authTimeout);
                    
                    // Event listener'ları temizle
                    const successIndex = this.eventListeners.auth_success.indexOf(authSuccessHandler);
                    if (successIndex !== -1) {
                        this.eventListeners.auth_success.splice(successIndex, 1);
                    }
                    
                    const failureIndex = this.eventListeners.auth_failure.indexOf(authFailureHandler);
                    if (failureIndex !== -1) {
                        this.eventListeners.auth_failure.splice(failureIndex, 1);
                    }
                    
                    reject(new Error(`Kimlik doğrulama başarısız: ${error || 'Bilinmeyen hata'}`));
                };
                
                // Event listener'ları ekle
                this.eventListeners.auth_success.push(authSuccessHandler);
                this.eventListeners.auth_failure.push(authFailureHandler);
                
                // Not: Sunucu bağlantı kurulduğunda otomatik olarak authChallenge gönderecek
                // ve _handleAuthChallenge metodu bunu işleyecek
                
            } catch (error) {
                console.error('CWebSenderClient: Kimlik doğrulama hatası:', error.message);
                reject(error);
            }
        });
    }

    /**
     * Private key'i yükle
     * @private
     */
    _loadPrivateKey() {
        try {
            // Private key doğrudan verilmiş mi?
            if (this.config.privateKey) {
                this.privateKey = this.config.privateKey;
                console.log('CWebSenderClient: Private key yapılandırmadan yüklendi');
            } 
            // Private key dosya yolu verilmiş mi?
            else if (this.config.privateKeyPath && fs) {
                try {
                    // Binary olarak oku ve Base64'e dönüştür
                    try {
                        const keyBuffer = fs.readFileSync(this.config.privateKeyPath);
                        this.privateKey = keyBuffer.toString('base64');
                        console.log('CWebSenderClient: Private key dosyadan binary olarak okundu ve Base64\'e dönüştürüldü');
                    } catch (binaryError) {
                        // Binary okuma başarısız olursa, text olarak dene
                        this.privateKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
                        console.log('CWebSenderClient: Private key dosyadan text olarak okundu');
                    }
                } catch (error) {
                    console.error('CWebSenderClient: Private key dosyası okunamadı:', error.message);
                    throw new Error('Private key dosyası okunamadı: ' + error.message);
                }
            } else {
                console.warn('CWebSenderClient: Private key belirtilmemiş, kimlik doğrulama yapılamayabilir');
            }
            
            // Private key formatını kontrol et ve düzelt
            if (this.privateKey) {
                // PKCS#1 formatını kontrol et (BEGIN RSA PRIVATE KEY)
                if (this.privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') && 
                    !this.privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
                    console.log('CWebSenderClient: PKCS#1 formatında private key tespit edildi');
                } 
                // PKCS#8 formatını kontrol et (BEGIN PRIVATE KEY)
                else if (this.privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
                    console.log('CWebSenderClient: PKCS#8 formatında private key tespit edildi');
                } 
                // Hiçbir başlık yoksa, muhtemelen düz içerik veya Base64
                else if (!this.privateKey.includes('-----BEGIN')) {
                    // Base64 formatında olup olmadığını kontrol et
                    const base64Regex = /^[A-Za-z0-9+/=]+$/;
                    if (base64Regex.test(this.privateKey.trim())) {
                        console.log('CWebSenderClient: Base64 formatında private key tespit edildi');
                        // Base64 formatını koru, _signNonce içinde dönüştürülecek
                    } else {
                        console.log('CWebSenderClient: Başlıksız private key tespit edildi, PKCS#8 formatına dönüştürülüyor');
                        // Düz içeriği PKCS#8 formatına dönüştür
                        this.privateKey = `-----BEGIN PRIVATE KEY-----\n${this.privateKey}\n-----END PRIVATE KEY-----`;
                    }
                }
            }
        } catch (error) {
            console.error('CWebSenderClient: Private key yükleme hatası:', error.message);
            throw error;
        }
    }

    /**
     * Gelen mesajı işle
     * @param {Object} message - Gelen mesaj
     * @private
     */
    _handleMessage(message) {
        try {
            // Mesaj formatını kontrol et
            if (!message) {
                console.warn('CWebSenderClient: Boş mesaj alındı');
                return;
            }
            
            if (!message.type) {
                console.warn('CWebSenderClient: Geçersiz mesaj formatı (tip eksik):', message);
                return;
            }
            
            // Her mesaj alındığında son aktivite zamanını güncelle
            this.lastActivity = Date.now();
            
            // Ping/pong mesajlarını loglamadan filtrele
            if (message.type !== 'ping' && message.type !== 'pong') {
                // Hassas bilgileri loglamadan önce filtrele
                let logMessage = { ...message };
                if (logMessage.type === 'authResponse' && logMessage.signature) {
                    logMessage.signature = '***FILTERED***';
                }
            }
            
            switch (message.type) {
                case 'pong':
                    // Pong mesajı alındı, ping zaman aşımını temizle
                    if (this.pingTimeout) {
                        clearTimeout(this.pingTimeout);
                        this.pingTimeout = null;
                    }
                    break;
                    
                case 'ping':
                    // Ping mesajı alındı, pong gönder
                    try {
                        const pongMessage = {
                            type: 'pong',
                            timestamp: message.timestamp
                        };
                        this._sendMessage(pongMessage);
                    } catch (pingError) {
                        console.error('CWebSenderClient: Pong gönderme hatası:', pingError.message);
                    }
                    break;
                    
                case 'authChallenge':
                    // Kimlik doğrulama challenge'ı
                    this._handleAuthChallenge(message);
                    break;
                    
                case 'authResponse':
                    // Kimlik doğrulama yanıtı
                    this._handleAuthResponse(message);
                    break;
                    
                // Java tarafından gelen yanıt tipleri
                case 'commandResponse':
                case 'placeholderResponse':
                case 'playerOnlineResponse':
                case 'onlinePlayersResponse':
                case 'broadcastResponse':
                case 'playerMessageResponse':
                case 'serverInfoResponse':
                    // Yanıt mesajı
                    if (message.id && this.responsePromises.has(message.id)) {
                        const { resolve, reject, timeout } = this.responsePromises.get(message.id);
                        clearTimeout(timeout);
                        this.responsePromises.delete(message.id);
                        
                        if (message.error) {
                            console.error(`CWebSenderClient: ${message.type} yanıtında hata:`, message.error);
                            reject(new Error(message.error));
                        } else {
                            resolve(message);
                        }
                    } else if (message.id) {
                        console.warn(`CWebSenderClient: Bilinmeyen ID ile yanıt alındı: ${message.id}, tip: ${message.type}`);
                    } else {
                        console.warn(`CWebSenderClient: ID'siz yanıt alındı: ${message.type}`);
                    }
                    break;
                    
                case 'response':
                    // Eski yanıt mesajı formatı
                    if (message.id && this.responsePromises.has(message.id)) {
                        const { resolve, reject, timeout } = this.responsePromises.get(message.id);
                        clearTimeout(timeout);
                        this.responsePromises.delete(message.id);
                        
                        if (message.error) {
                            console.error('CWebSenderClient: Yanıtta hata:', message.error);
                            reject(new Error(message.error));
                        } else {
                            resolve(message);
                        }
                    } else if (message.id) {
                        console.warn(`CWebSenderClient: Bilinmeyen ID ile yanıt alındı: ${message.id}`);
                    } else {
                        console.warn('CWebSenderClient: ID\'siz yanıt alındı');
                    }
                    break;
                    
                case 'error':
                    // Hata mesajı
                    console.error('CWebSenderClient: Sunucudan hata:', message.message || 'Bilinmeyen hata');
                    
                    // Eğer ID varsa, ilgili promise'i reject et
                    if (message.id && this.responsePromises.has(message.id)) {
                        const { reject, timeout } = this.responsePromises.get(message.id);
                        clearTimeout(timeout);
                        this.responsePromises.delete(message.id);
                        reject(new Error(message.message || 'Sunucudan bilinmeyen hata'));
                    }
                    
                    // Hata olayını tetikle
                    this._triggerEvent('error', { message: message.message, code: message.code });
                    break;
                    
                case 'event':
                    // Olay mesajı
                    if (message.event) {
                        try {
                            this._triggerEvent(message.event, message.data);
                        } catch (eventError) {
                            console.error(`CWebSenderClient: '${message.event}' olayı işlenirken hata:`, eventError.message);
                        }
                    } else {
                        console.warn('CWebSenderClient: Olay adı olmayan event mesajı alındı:', message);
                    }
                    break;
                    
                case 'auth_response':
                    // Eski kimlik doğrulama yanıtı (zaten _authenticate metodunda işleniyor)
                    break;
                    
                default:
                    // Bilinmeyen mesaj tipi
                    console.warn('CWebSenderClient: Bilinmeyen mesaj tipi:', message.type, message);
            }
        } catch (error) {
            console.error('CWebSenderClient: Mesaj işleme hatası:', error.message, error.stack);
        }
    }

    /**
     * Kimlik doğrulama challenge'ını işle
     * @param {Object} message - Challenge mesajı
     * @private
     */
    _handleAuthChallenge(message) {
        try {
            console.log('CWebSenderClient: Kimlik doğrulama challenge alındı');
            
            // Challenge'dan nonce ve publicKey'i al
            const nonce = message.nonce;
            const publicKey = message.publicKey;
            
            if (!nonce) {
                console.error('CWebSenderClient: Challenge mesajında nonce eksik');
                this._triggerEvent('auth_failure', 'Challenge mesajında nonce eksik');
                return;
            }
            
            // Nonce'u imzala
            let signature;
            try {
                signature = this._signNonce(nonce);
            } catch (signError) {
                console.error('CWebSenderClient: Nonce imzalama hatası:', signError.message);
                this._triggerEvent('auth_failure', `Nonce imzalama hatası: ${signError.message}`);
                return;
            }
            
            if (!signature) {
                console.error('CWebSenderClient: Nonce imzalanamadı');
                this._triggerEvent('auth_failure', 'Nonce imzalanamadı');
                return;
            }
            
            // Kimlik doğrulama yanıtı gönder
            const authResponse = {
                type: 'authResponse',
                nonce: nonce,
                signature: signature
            };
            
            console.log('CWebSenderClient: Kimlik doğrulama yanıtı gönderiliyor');
            try {
                this._sendMessage(authResponse);
            } catch (sendError) {
                console.error('CWebSenderClient: Kimlik doğrulama yanıtı gönderme hatası:', sendError.message);
                this._triggerEvent('auth_failure', `Kimlik doğrulama yanıtı gönderme hatası: ${sendError.message}`);
            }
            
        } catch (error) {
            console.error('CWebSenderClient: Kimlik doğrulama challenge işleme hatası:', error.message);
            this._triggerEvent('auth_failure', `Kimlik doğrulama challenge işleme hatası: ${error.message}`);
        }
    }

    /**
     * Kimlik doğrulama yanıtını işle
     * @param {Object} message - Kimlik doğrulama yanıtı
     * @private
     */
    _handleAuthResponse(message) {
        try {
            // Hassas bilgileri loglamadan önce filtrele
            let logMessage = { ...message };
            if (logMessage.signature) {
                logMessage.signature = '***FILTERED***';
            }
            console.log('CWebSenderClient: Kimlik doğrulama yanıtı alındı:', logMessage);
            
            if (!message.status) {
                console.error('CWebSenderClient: Kimlik doğrulama yanıtında status alanı eksik');
                this.authenticated = false;
                this._triggerEvent('auth_failure', 'Kimlik doğrulama yanıtında status alanı eksik');
                return;
            }
            
            if (message.status === 'success') {
                console.log('CWebSenderClient: Kimlik doğrulama başarılı');
                this.authenticated = true;
                this._triggerEvent('auth_success');
            } else {
                const errorMessage = message.message || message.error || 'Bilinmeyen hata';
                console.error('CWebSenderClient: Kimlik doğrulama başarısız:', errorMessage);
                this.authenticated = false;
                this._triggerEvent('auth_failure', errorMessage);
            }
        } catch (error) {
            console.error('CWebSenderClient: Kimlik doğrulama yanıtı işleme hatası:', error.message);
            this.authenticated = false;
            this._triggerEvent('auth_failure', `Kimlik doğrulama yanıtı işleme hatası: ${error.message}`);
        }
    }

    /**
     * Nonce'u imzala
     * @param {string} nonce - İmzalanacak nonce
     * @returns {string} Base64 formatında imza
     * @private
     */
    _signNonce(nonce) {
        try {
            // Private key'in yüklü olduğunu kontrol et
            if (!this.privateKey) {
                throw new Error('Private key yüklenmemiş');
            }
            
            // RSA-SHA256 ile imzala
            const sign = crypto.createSign('RSA-SHA256');
            sign.update(nonce);
            
            // Private key'i temizle ve doğru formata getir
            let privateKeyFormatted = this.privateKey;
            
            // Private key formatını kontrol et
            if (!privateKeyFormatted.includes('-----BEGIN') && !privateKeyFormatted.includes('-----END')) {
                // Düz içeriği PKCS#8 formatına dönüştür
                privateKeyFormatted = `-----BEGIN PRIVATE KEY-----\n${privateKeyFormatted}\n-----END PRIVATE KEY-----`;
            }
            
            try {
                // İmzayı oluştur
                const signature = sign.sign(privateKeyFormatted, 'base64');
                console.log('CWebSenderClient: Nonce başarıyla imzalandı');
                return signature;
            } catch (signError) {
                console.error('CWebSenderClient: İmzalama hatası:', signError.message);
                
                // Alternatif yöntem dene - PKCS#1 formatı
                try {
                    console.log('CWebSenderClient: Alternatif imzalama yöntemi deneniyor (PKCS#1)');
                    let altPrivateKey = this.privateKey;
                    
                    // PKCS#1 formatına dönüştür
                    if (!altPrivateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
                        altPrivateKey = `-----BEGIN RSA PRIVATE KEY-----\n${altPrivateKey.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').trim()}\n-----END RSA PRIVATE KEY-----`;
                    }
                    
                    const altSign = crypto.createSign('RSA-SHA256');
                    altSign.update(nonce);
                    const altSignature = altSign.sign(altPrivateKey, 'base64');
                    console.log('CWebSenderClient: Nonce alternatif yöntemle başarıyla imzalandı');
                    return altSignature;
                } catch (altError) {
                    console.error('CWebSenderClient: Alternatif imzalama hatası:', altError.message);
                    
                    // Son bir deneme - düz Base64 formatı
                    try {
                        console.log('CWebSenderClient: Son imzalama yöntemi deneniyor (düz Base64)');
                        const rawKey = this.privateKey.replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
                                                     .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
                                                     .replace(/\s+/g, '');
                        
                        const finalSign = crypto.createSign('RSA-SHA256');
                        finalSign.update(nonce);
                        
                        // Node.js'in Buffer'ı kullanarak Base64'ten çözme
                        const keyBuffer = Buffer.from(rawKey, 'base64');
                        const finalSignature = finalSign.sign(keyBuffer, 'base64');
                        console.log('CWebSenderClient: Nonce son yöntemle başarıyla imzalandı');
                        return finalSignature;
                    } catch (finalError) {
                        console.error('CWebSenderClient: Son imzalama denemesi başarısız:', finalError.message);
                        throw new Error(`İmzalama başarısız: ${finalError.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('CWebSenderClient: Nonce imzalama hatası:', error.message);
            throw error;
        }
    }

    /**
     * Mesaj gönder ve yanıt bekle
     * @param {Object} message - Gönderilecek mesaj
     * @returns {Promise} Yanıt Promise'i
     * @private
     */
    _sendRequest(message) {
        return new Promise((resolve, reject) => {
            try {
                // Bağlantı durumunu kontrol et
                if (!this.ws) {
                    return reject(new Error('WebSocket bağlantısı kurulmamış'));
                }
                
                if (this.ws.readyState !== WebSocket.OPEN) {
                    return reject(new Error(`WebSocket bağlantısı açık değil (Durum: ${this.ws.readyState})`));
                }
                
                // Kimlik doğrulama durumunu kontrol et
                if (!this.authenticated) {
                    return reject(new Error('Kimlik doğrulaması yapılmadı, lütfen önce connect() metodunu çağırın'));
                }
                
                // Mesaj ID'si ata
                const id = this._generateMessageId();
                message.id = id;
                
                // Zaman aşımı için
                const timeout = setTimeout(() => {
                    if (this.responsePromises.has(id)) {
                        this.responsePromises.delete(id);
                        reject(new Error(`"${message.type}" isteği için yanıt zaman aşımına uğradı (${this.config.timeout}ms)`));
                    }
                }, this.config.timeout);
                
                // Promise'i kaydet
                this.responsePromises.set(id, { resolve, reject, timeout });
                
                // Mesajı gönder
                try {
                    this._sendMessage(message);
                } catch (sendError) {
                    // Mesaj gönderme hatası durumunda promise'i temizle
                    clearTimeout(timeout);
                    this.responsePromises.delete(id);
                    return reject(new Error(`Mesaj gönderme hatası: ${sendError.message}`));
                }
            } catch (error) {
                // Genel hata durumunda
                reject(new Error(`İstek gönderme hatası: ${error.message}`));
            }
        });
    }

    /**
     * Mesaj gönder
     * @param {Object} message - Gönderilecek mesaj
     * @private
     */
    _sendMessage(message) {
        try {
            // Bağlantı durumunu kontrol et
            if (!this.ws) {
                throw new Error('WebSocket bağlantısı kurulmamış');
            }
            
            if (this.ws.readyState !== WebSocket.OPEN) {
                throw new Error(`WebSocket bağlantısı açık değil (Durum: ${this.ws.readyState})`);
            }
            
            this.lastActivity = Date.now();
            const messageStr = JSON.stringify(message);
            
            // Hassas bilgileri loglamadan önce filtrele
            let logMessage = { ...message };
            if (logMessage.type === 'authResponse' && logMessage.signature) {
                logMessage.signature = '***FILTERED***';
            }
            
            // Mesajı gönder
            this.ws.send(messageStr);
        } catch (error) {
            console.error('CWebSenderClient: Mesaj gönderme hatası:', error.message);
            throw error; // Hatayı yukarı ilet
        }
    }

    /**
     * Benzersiz mesaj ID'si oluştur
     * @returns {string} Mesaj ID'si
     * @private
     */
    _generateMessageId() {
        return `${Date.now()}-${this.messageIdCounter++}`;
    }

    /**
     * Event listener'ları çağır
     * @param {string} event - Olay adı
     * @param {*} data - Olay verisi
     * @private
     */
    _triggerEvent(event, data) {
        if (!event) {
            console.warn('CWebSenderClient: Geçersiz olay adı ile _triggerEvent çağrıldı');
            return;
        }
        
        if (!this.eventListeners[event] || this.eventListeners[event].length === 0) {
            // Bu olay için dinleyici yok, sadece debug için loglama yap
            if (event !== 'open' && event !== 'close' && event !== 'error') {
                console.debug(`CWebSenderClient: '${event}' olayı için dinleyici bulunamadı`);
            }
            return;
        }
        
        console.log(`CWebSenderClient: '${event}' olayı tetikleniyor (${this.eventListeners[event].length} dinleyici)`);
        
        for (const listener of this.eventListeners[event]) {
            try {
                listener(data);
            } catch (error) {
                console.error(`CWebSenderClient: '${event}' olayı işlenirken hata:`, error.message);
                // Hatayı yukarı iletme, diğer dinleyicilerin çalışmasını engelleme
            }
        }
    }

    /**
     * Event listener ekle
     * @param {string} event - Olay adı
     * @param {Function} callback - Callback fonksiyonu
     * @returns {CWebSenderClient} Zincir için this döndürür
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
        return this;
    }

    /**
     * Event listener kaldır
     * @param {string} event - Olay adı
     * @param {Function} callback - Kaldırılacak callback fonksiyonu
     * @returns {CWebSenderClient} Zincir için this döndürür
     */
    off(event, callback) {
        if (this.eventListeners[event]) {
            this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
        }
        return this;
    }

    /**
     * Tüm event listener'ları kaldır
     * @param {string} [event] - Olay adı (belirtilmezse tüm olaylar)
     * @returns {CWebSenderClient} Zincir için this döndürür
     */
    removeAllListeners(event) {
        if (event) {
            this.eventListeners[event] = [];
        } else {
            for (const key in this.eventListeners) {
                this.eventListeners[key] = [];
            }
        }
        return this;
    }

    /**
     * Bağlantıyı kapat
     * @returns {Promise} Bağlantı kapatıldığında resolve olan Promise
     */
    disconnect() {
        return new Promise((resolve) => {
            try {
                if (!this.ws) {
                    console.log('CWebSenderClient: Bağlantı zaten kapalı');
                    resolve();
                    return;
                }
                
                if (this.ws.readyState === WebSocket.CLOSED) {
                    console.log('CWebSenderClient: Bağlantı zaten kapalı');
                    resolve();
                    return;
                }
                
                // Ping-pong mekanizmasını durdur
                this._stopPingPong();
                
                // Kimlik doğrulama durumunu sıfırla
                this.authenticated = false;
                
                // Bekleyen tüm istekleri iptal et
                if (this.responsePromises.size > 0) {
                    console.log(`CWebSenderClient: ${this.responsePromises.size} bekleyen istek iptal ediliyor`);
                    for (const [id, { reject, timeout }] of this.responsePromises.entries()) {
                        clearTimeout(timeout);
                        reject(new Error('Bağlantı kapatıldı'));
                        this.responsePromises.delete(id);
                    }
                }
                
                console.log('CWebSenderClient: Bağlantı kapatılıyor');
                
                const onClose = () => {
                    this.ws.removeEventListener('close', onClose);
                    console.log('CWebSenderClient: Bağlantı başarıyla kapatıldı');
                    resolve();
                };
                
                this.ws.addEventListener('close', onClose);
                
                // Bağlantıyı kapat
                try {
                    this.ws.close(1000, 'İstemci tarafından kapatıldı');
                } catch (closeError) {
                    console.error('CWebSenderClient: Bağlantı kapatılırken hata:', closeError.message);
                    // Hata olsa bile resolve et
                    this.ws.removeEventListener('close', onClose);
                    resolve();
                }
            } catch (error) {
                console.error('CWebSenderClient: Bağlantı kapatma hatası:', error.message);
                // Hata olsa bile resolve et
                resolve();
            }
        });
    }

    /**
     * Komut çalıştır
     * @param {string} command - Çalıştırılacak komut
     * @returns {Promise<Object>} Yanıt Promise'i
     */
    executeCommand(command) {
        return this._sendRequest({
            type: 'command',
            command: command
        });
    }

    /**
     * Placeholder değerini al
     * @param {string} placeholder - Placeholder
     * @param {string} player - Oyuncu adı (opsiyonel)
     * @returns {Promise<Object>} Yanıt Promise'i
     */
    parsePlaceholder(placeholder, player) {
        const request = {
            type: 'placeholder',
            placeholder: placeholder
        };
        
        if (player) {
            request.player = player;
        }
        
        return this._sendRequest(request);
    }

    /**
     * Oyuncunun çevrimiçi olup olmadığını kontrol et
     * @param {string} player - Oyuncu adı
     * @returns {Promise<Object>} Yanıt Promise'i
     */
    isPlayerOnline(player) {
        return this._sendRequest({
            type: 'isPlayerOnline',
            player: player
        });
    }

    /**
     * Çevrimiçi oyuncuları al
     * @returns {Promise<Object>} Yanıt Promise'i
     */
    getOnlinePlayers() {
        return this._sendRequest({
            type: 'getOnlinePlayers'
        });
    }

    /**
     * Sunucu bilgilerini al
     * @returns {Promise<Object>} Yanıt Promise'i
     */
    getServerInfo() {
        return this._sendRequest({
            type: 'getServerInfo'
        });
    }

    /**
     * Ping-pong mekanizmasını başlat
     * @private
     */
    _startPingPong() {
        // Önceki ping-pong'u temizle
        this._stopPingPong();
        
        // Düzenli aralıklarla ping gönder
        this.pingTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
                console.debug('CWebSenderClient: Ping gönderilmiyor - bağlantı açık değil veya kimlik doğrulaması yapılmamış');
                return;
            }
            
            try {
                // Son aktiviteden beri geçen süre
                const timeSinceLastActivity = Date.now() - this.lastActivity;
                
                // Eğer son aktiviteden beri ping aralığından daha az zaman geçtiyse ping gönderme
                if (timeSinceLastActivity < this.config.pingInterval) {
                    console.debug(`CWebSenderClient: Son aktivite ${timeSinceLastActivity}ms önce, ping gönderilmiyor`);
                    return;
                }
                
                // Ping mesajı gönder
                const pingMessage = {
                    type: 'ping',
                    timestamp: Date.now()
                };
                
                this.ws.send(JSON.stringify(pingMessage));
                console.debug('CWebSenderClient: Ping gönderildi');
                
                // Ping zaman aşımı
                if (this.pingTimeout) {
                    clearTimeout(this.pingTimeout);
                }
                
                this.pingTimeout = setTimeout(() => {
                    console.error('CWebSenderClient: Ping zaman aşımına uğradı, bağlantı kapatılıyor');
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        try {
                            this.ws.close(1000, 'Ping zaman aşımı');
                        } catch (closeError) {
                            console.error('CWebSenderClient: Bağlantı kapatılırken hata:', closeError.message);
                        }
                    }
                }, 10000); // 10 saniye içinde pong gelmezse bağlantıyı kapat
                
            } catch (error) {
                console.error('CWebSenderClient: Ping gönderme hatası:', error.message);
                
                // Ping gönderme hatası durumunda bağlantıyı kontrol et
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    try {
                        // Bağlantı hala açıksa, bir sonraki ping denemesine kadar bekle
                        console.log('CWebSenderClient: Bağlantı hala açık, bir sonraki ping denemesi bekleniyor');
                    } catch (checkError) {
                        console.error('CWebSenderClient: Bağlantı durumu kontrol edilirken hata:', checkError.message);
                    }
                }
            }
        }, this.config.pingInterval);
    }

    /**
     * Ping-pong mekanizmasını durdur
     * @private
     */
    _stopPingPong() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
            console.debug('CWebSenderClient: Ping-pong zamanlayıcısı durduruldu');
        }
        
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
            console.debug('CWebSenderClient: Ping zaman aşımı temizlendi');
        }
    }
}

// Node.js için modülü dışa aktar
if (typeof module !== 'undefined') {
    module.exports = CWebSenderClient;
}

// Tarayıcı için global değişkene ata
if (typeof window !== 'undefined') {
    window.CWebSenderClient = CWebSenderClient;
} 