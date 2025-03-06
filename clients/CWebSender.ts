/**
 * WebSender TypeScript İstemci Kütüphanesi
 * 
 * Bu kütüphane, WebSender API'sine WebSocket üzerinden bağlanmayı ve
 * RSA tabanlı kimlik doğrulamayı sağlar.
 * 
 * @author BlokDiyari
 * @version 1.0.0
 */

// Node.js ortamı için gerekli import'lar
// @ts-ignore - Modül kullanılacaksa önce kurulmalıdır: npm install ws @types/ws
import WebSocket from 'ws'; // Browser'da kullanılacaksa bu import'u kaldırın
// @ts-ignore - Node.js modülleri
import * as crypto from 'crypto'; // Node.js crypto modülü
import * as fs from 'fs'; // Node.js fs modülü

/**
 * İstemci Yapılandırma Arayüzü
 */
interface CWebSenderConfig {
    serverUrl: string;
    privateKey?: string;
    privateKeyPath?: string;
    timeout?: number;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnects?: number;
    pingInterval?: number;
    debug?: boolean;
}

/**
 * Yanıt Promise Veri Arayüzü
 */
interface ResponsePromiseData {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
}

/**
 * WebSender API istemci sınıfı
 */
export class CWebSenderClient {
    private serverUrl: string;
    private config: CWebSenderConfig;
    private ws: WebSocket | null = null;
    private privateKey: string | null = null;
    private messageIdCounter: number = 1;
    private responsePromises: Map<string, ResponsePromiseData> = new Map();
    private authenticated: boolean = false;
    private reconnectAttempts: number = 0;
    private lastActivity: number = Date.now();
    private pingTimer: NodeJS.Timeout | null = null;
    private pingTimeout: NodeJS.Timeout | null = null;
    private eventListeners: { [key: string]: Array<(data?: any) => void> } = {};
    private isBrowser: boolean = typeof window !== 'undefined';

    /**
     * CWebSenderClient constructor
     * 
     * @param config WebSocket URL'si veya yapılandırma nesnesi
     * @param options Bağlantı seçenekleri (config bir string ise)
     */
    constructor(config: string | CWebSenderConfig, options: Partial<CWebSenderConfig> = {}) {
        // Config bir string ise (URL olarak verilmiş)
        if (typeof config === 'string') {
            this.serverUrl = config;
            this.config = options as CWebSenderConfig;
        } else {
            this.serverUrl = config.serverUrl;
            this.config = config;
        }

        // Varsayılan değerler
        this.config.timeout = this.config.timeout || 30000;
        this.config.reconnect = this.config.reconnect !== false;
        this.config.reconnectInterval = this.config.reconnectInterval || 5000;
        this.config.maxReconnects = this.config.maxReconnects || 10;
        this.config.pingInterval = this.config.pingInterval || 30000;

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
     * @returns Bağlantı kurulduğunda resolve olan Promise
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Önceki bağlantıyı kapat
                if (this.ws) {
                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn('CWebSenderClient: Önceki bağlantı kapatılırken hata:', closeError instanceof Error ? closeError.message : closeError);
                    }
                    
                    // Önceki bağlantının tamamen kapanması için kısa bir bekleme
                    setTimeout(() => this._initConnection(resolve, reject), 1000);
                } else {
                    this._initConnection(resolve, reject);
                }
            } catch (error) {
                console.error('CWebSenderClient: Bağlantı kurulurken hata:', error instanceof Error ? error.message : error);
                reject(error);
            }
        });
    }

    /**
     * WebSocket bağlantısını başlat
     * @param resolve Promise resolve fonksiyonu
     * @param reject Promise reject fonksiyonu
     * @private
     */
    private _initConnection(resolve: (value: void) => void, reject: (reason: any) => void): void {
        try {
            // Private key'i yükle
            try {
                this._loadPrivateKey();
            } catch (keyError) {
                console.error('CWebSenderClient: Private key yükleme hatası:', keyError instanceof Error ? keyError.message : keyError);
                return reject(new Error(`Private key yükleme hatası: ${keyError instanceof Error ? keyError.message : keyError}`));
            }
            
            console.log(`CWebSenderClient: ${this.serverUrl} adresine bağlanılıyor...`);
            
            // WebSocket bağlantısı kur
            try {
                // Browser ve Node.js için farklı WebSocket oluşturma
                if (this.isBrowser) {
                    this.ws = new (window as any).WebSocket(this.serverUrl);
                } else {
                    this.ws = new WebSocket(this.serverUrl);
                }
            } catch (wsError) {
                console.error('CWebSenderClient: WebSocket oluşturulurken hata:', wsError instanceof Error ? wsError.message : wsError);
                return reject(new Error(`WebSocket oluşturulurken hata: ${wsError instanceof Error ? wsError.message : wsError}`));
            }
            
            // Bağlantı zaman aşımı
            const connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                    console.error('CWebSenderClient: Bağlantı zaman aşımına uğradı');
                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn('CWebSenderClient: Bağlantı kapatılırken hata:', closeError instanceof Error ? closeError.message : closeError);
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
                        console.error('CWebSenderClient: Kimlik doğrulama başarısız:', error instanceof Error ? error.message : error);
                        try {
                            this.ws?.close();
                        } catch (closeError) {
                            console.warn('CWebSenderClient: Bağlantı kapatılırken hata:', closeError instanceof Error ? closeError.message : closeError);
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
                if (this.config.reconnect && this.reconnectAttempts < (this.config.maxReconnects || 10)) {
                    // 1005 ve 1006 hata kodları için daha uzun bekleme süresi
                    let multiplier = 1;
                    if (event.code === 1005 || event.code === 1006) {
                        multiplier = 2; // Daha uzun bekle
                    }
                    
                    this.reconnectAttempts++;
                    const delay = (this.config.reconnectInterval || 5000) * Math.min(this.reconnectAttempts, 10) * multiplier;
                    console.log(`CWebSenderClient: ${delay}ms sonra yeniden bağlanılacak (${this.reconnectAttempts}/${this.config.maxReconnects})`);
                    
                    setTimeout(() => {
                        this.connect().catch(error => {
                            console.error('CWebSenderClient: Yeniden bağlanma hatası:', error instanceof Error ? error.message : error);
                        });
                    }, delay);
                } else if (this.reconnectAttempts >= (this.config.maxReconnects || 10)) {
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
                        console.warn('CWebSenderClient: Hata sonrası bağlantı kapatılırken hata:', closeError instanceof Error ? closeError.message : closeError);
                    }
                }
            };
            
            // Mesaj alındığında
            this.ws.onmessage = (event) => {
                this.lastActivity = Date.now();
                try {
                    const message = JSON.parse(event.data.toString());
                    this._handleMessage(message);
                } catch (error) {
                    console.error('CWebSenderClient: Mesaj işleme hatası:', error instanceof Error ? error.message : error);
                }
            };
            
        } catch (error) {
            console.error('CWebSenderClient: Bağlantı kurulurken hata:', error instanceof Error ? error.message : error);
            reject(error);
        }
    }

    /**
     * Kimlik doğrulama işlemi
     * @returns Kimlik doğrulama tamamlandığında resolve olan Promise
     * @private
     */
    private _authenticate(): Promise<void> {
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
                const authFailureHandler = (error: any) => {
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
                console.error('CWebSenderClient: Kimlik doğrulama hatası:', error instanceof Error ? error.message : error);
                reject(error);
            }
        });
    }

    /**
     * Private key'i yükle
     * @private
     */
    private _loadPrivateKey(): void {
        try {
            // Private key doğrudan verilmiş mi?
            if (this.config.privateKey) {
                this.privateKey = this.config.privateKey;
                console.log('CWebSenderClient: Private key yapılandırmadan yüklendi');
            } 
            // Private key dosya yolu verilmiş mi ve Node.js ortamında mıyız?
            else if (this.config.privateKeyPath && !this.isBrowser && fs) {
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
                    console.error('CWebSenderClient: Private key dosyası okunamadı:', error instanceof Error ? error.message : error);
                    throw new Error(`Private key dosyası okunamadı: ${error instanceof Error ? error.message : error}`);
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
            console.error('CWebSenderClient: Private key yükleme hatası:', error instanceof Error ? error.message : error);
            throw error;
        }
    }

    /**
     * Gelen mesajı işle
     * @param message Gelen mesaj
     * @private
     */
    private _handleMessage(message: any): void {
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
            
            // Mesaj türüne göre işlem yap
            switch (message.type) {
                case 'error':
                    console.error('CWebSenderClient: Sunucudan hata:', message.message || 'Bilinmeyen hata');
                    this._triggerEvent('error', { message: message.message || 'Bilinmeyen hata' });
                    break;
                    
                case 'ping':
                    // Ping mesajına pong ile yanıt ver
                    this._sendMessage({ type: 'pong' });
                    break;
                    
                case 'pong':
                    // Sunucudan pong yanıtı geldi, bağlantı aktif
                    this.lastActivity = Date.now();
                    break;
                    
                case 'authChallenge':
                    // Kimlik doğrulama challenge'ı
                    this._handleAuthChallenge(message);
                    break;
                    
                case 'authResponse':
                    // Kimlik doğrulama yanıtı
                    this._handleAuthResponse(message);
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
                    if (message.id && this.responsePromises.has(message.id)) {
                        const { resolve, reject, timeout } = this.responsePromises.get(message.id)!;
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
                    
                default:
                    console.warn(`CWebSenderClient: Bilinmeyen mesaj türü: ${message.type}`);
            }
        } catch (error) {
            console.error('CWebSenderClient: Mesaj işleme hatası:', error instanceof Error ? error.message : error);
        }
    }

    /**
     * Kimlik doğrulama challenge'ını işle
     * @param message Gelen mesaj
     * @private
     */
    private _handleAuthChallenge(message: any): void {
        try {
            if (!message.nonce || !message.publicKey) {
                console.error('CWebSenderClient: Geçersiz auth challenge formatı');
                this._triggerEvent('auth_failure', 'Geçersiz auth challenge formatı');
                return;
            }
            
            console.log('CWebSenderClient: Auth challenge alındı, nonce:', message.nonce);
            
            // Nonce'u imzala
            const signature = this._signNonce(message.nonce);
            if (!signature) {
                console.error('CWebSenderClient: Nonce imzalanamadı');
                this._triggerEvent('auth_failure', 'Nonce imzalanamadı');
                return;
            }
            
            // Auth yanıtı gönder
            this._sendMessage({
                type: 'authResponse',
                nonce: message.nonce,
                signature: signature
            });
            
        } catch (error) {
            console.error('CWebSenderClient: Auth challenge işleme hatası:', error instanceof Error ? error.message : error);
            this._triggerEvent('auth_failure', error instanceof Error ? error.message : error);
        }
    }

    /**
     * Kimlik doğrulama yanıtını işle
     * @param message Gelen mesaj
     * @private
     */
    private _handleAuthResponse(message: any): void {
        try {
            if (message.status === 'success') {
                console.log('CWebSenderClient: Kimlik doğrulama başarılı');
                this.authenticated = true;
                this._triggerEvent('auth_success');
            } else {
                console.error('CWebSenderClient: Kimlik doğrulama başarısız:', message.message || 'Bilinmeyen hata');
                this.authenticated = false;
                this._triggerEvent('auth_failure', message.message || 'Bilinmeyen hata');
            }
        } catch (error) {
            console.error('CWebSenderClient: Auth response işleme hatası:', error instanceof Error ? error.message : error);
            this._triggerEvent('auth_failure', error instanceof Error ? error.message : error);
        }
    }

    /**
     * Nonce'u imzala
     * @param nonce İmzalanacak nonce
     * @returns Base64 formatında imza
     * @private
     */
    private _signNonce(nonce: string): string | null {
        try {
            if (!this.privateKey) {
                console.error('CWebSenderClient: Private key mevcut değil, imzalama yapılamıyor');
                return null;
            }
            
            let signature: string;
            
            // Browser ve Node.js için farklı imzalama
            if (this.isBrowser) {
                // Browser'da crypto API kullanımı (örnek olarak - gerçek uygulamada
                // bir RSA imzalama kütüphanesi kullanmanız gerekebilir)
                console.error('CWebSenderClient: Tarayıcıda imzalama için özel bir kütüphane kullanılmalıdır');
                return null;
            } else {
                // Node.js'de crypto modülü kullanımı
                const sign = crypto.createSign('SHA256');
                sign.update(nonce);
                signature = sign.sign(this.privateKey, 'base64');
            }
            
            return signature;
            
        } catch (error) {
            console.error('CWebSenderClient: Nonce imzalama hatası:', error instanceof Error ? error.message : error);
            return null;
        }
    }

    /**
     * İstek gönder ve yanıt bekle
     * @param message İstek mesajı
     * @returns Yanıt Promise'i
     * @private
     */
    private _sendRequest(message: any): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                if (!this.authenticated) {
                    reject(new Error('Kimlik doğrulaması yapılmamış'));
                    return;
                }
                
                const messageId = this._generateMessageId();
                message.id = messageId;
                
                // Yanıt beklemek için zaman aşımı
                const timeout = setTimeout(() => {
                    if (this.responsePromises.has(messageId)) {
                        this.responsePromises.delete(messageId);
                        reject(new Error(`İstek zaman aşımına uğradı (${this.config.timeout}ms)`));
                    }
                }, this.config.timeout);
                
                // Yanıt Promise'ini kaydet
                this.responsePromises.set(messageId, { resolve, reject, timeout });
                
                // İsteği gönder
                this._sendMessage(message);
                
            } catch (error) {
                reject(new Error(`İstek gönderme hatası: ${error instanceof Error ? error.message : error}`));
            }
        });
    }

    /**
     * Mesaj gönder
     * @param message Gönderilecek mesaj
     * @returns Başarıyla gönderildi ise true
     * @private
     */
    private _sendMessage(message: any): boolean {
        try {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.error('CWebSenderClient: WebSocket bağlantısı açık değil');
                return false;
            }
            
            const jsonMessage = JSON.stringify(message);
            this.ws.send(jsonMessage);
            
            // Son aktivite zamanını güncelle
            this.lastActivity = Date.now();
            return true;
            
        } catch (error) {
            console.error('CWebSenderClient: Mesaj gönderme hatası:', error instanceof Error ? error.message : error);
            return false;
        }
    }

    /**
     * Benzersiz mesaj ID'si oluştur
     * @returns Mesaj ID'si
     * @private
     */
    private _generateMessageId(): string {
        const prefix = Math.random().toString(36).substring(2, 15);
        return `${prefix}-${this.messageIdCounter++}`;
    }

    /**
     * Event tetikle
     * @param event Event adı
     * @param data Event verisi
     * @private
     */
    private _triggerEvent(event: string, data?: any): void {
        if (!(event in this.eventListeners)) {
            return;
        }
        
        for (const callback of this.eventListeners[event]) {
            try {
                callback(data);
            } catch (error) {
                console.error(`CWebSenderClient: Event handler hatası (${event}):`, error instanceof Error ? error.message : error);
            }
        }
    }

    /**
     * Ping-pong mekanizmasını başlat
     * @private
     */
    private _startPingPong(): void {
        this._stopPingPong(); // Önceden çalışan varsa durdur
        
        // Düzenli olarak ping gönder
        this.pingTimer = setInterval(() => {
            // Son aktiviteden beri geçen süre
            const inactiveTime = Date.now() - this.lastActivity;
            
            // Belirli bir süre inaktifse ping gönder
            if (inactiveTime > (this.config.pingInterval || 30000) / 2) {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this._sendMessage({ type: 'ping' });
                    
                    // Ping yanıtı için zaman aşımı başlat
                    if (this.pingTimeout) {
                        clearTimeout(this.pingTimeout);
                    }
                    
                    this.pingTimeout = setTimeout(() => {
                        const pingResponseTime = Date.now() - this.lastActivity;
                        
                        // Ping yanıtı alınmadıysa bağlantıyı kapat
                        if (pingResponseTime > (this.config.pingInterval || 30000)) {
                            console.error('CWebSenderClient: Ping yanıtı alınamadı, bağlantı kapatılıyor');
                            try {
                                if (this.ws) {
                                    this.ws.close(1000, 'Ping timeout');
                                }
                            } catch (error) {
                                console.error('CWebSenderClient: Ping timeout sonrası bağlantı kapatılırken hata:', error instanceof Error ? error.message : error);
                            }
                        }
                    }, (this.config.pingInterval || 30000) / 2);
                }
            }
        }, (this.config.pingInterval || 30000) / 4);
    }

    /**
     * Ping-pong mekanizmasını durdur
     * @private
     */
    private _stopPingPong(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
        }
    }

    /**
     * Event listener ekle
     * @param event Event adı
     * @param callback Callback fonksiyonu
     */
    public on(event: string, callback: (data?: any) => void): void {
        if (!(event in this.eventListeners)) {
            this.eventListeners[event] = [];
        }
        
        this.eventListeners[event].push(callback);
    }

    /**
     * Event listener kaldır
     * @param event Event adı
     * @param callback Kaldırılacak callback
     */
    public off(event: string, callback: (data?: any) => void): void {
        if (!(event in this.eventListeners)) {
            return;
        }
        
        const index = this.eventListeners[event].indexOf(callback);
        if (index !== -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }

    /**
     * Tüm event listener'ları kaldır
     * @param event Event adı (belirtilmezse tüm event'ler için)
     */
    public removeAllListeners(event?: string): void {
        if (event) {
            if (event in this.eventListeners) {
                this.eventListeners[event] = [];
            }
        } else {
            for (const evt in this.eventListeners) {
                this.eventListeners[evt] = [];
            }
        }
    }

    /**
     * Bağlantıyı kapat
     */
    public disconnect(): void {
        this._stopPingPong();
        
        if (this.ws) {
            // Tüm yanıt bekleyen Promise'leri iptal et
            for (const [messageId, { reject, timeout }] of this.responsePromises.entries()) {
                clearTimeout(timeout);
                reject(new Error('Bağlantı kapatıldı'));
                this.responsePromises.delete(messageId);
            }
            
            try {
                this.ws.close(1000, 'Kullanıcı tarafından kapatıldı');
                this.ws = null;
                this.authenticated = false;
                
                console.log('CWebSenderClient: Bağlantı kapatıldı');
                this._triggerEvent('close', { code: 1000, reason: 'Kullanıcı tarafından kapatıldı' });
            } catch (error) {
                console.error('CWebSenderClient: Bağlantı kapatılırken hata:', error instanceof Error ? error.message : error);
            }
        }
    }

    /**
     * Komut çalıştır
     * @param command Çalıştırılacak komut
     * @returns Yanıt Promise'i
     */
    public executeCommand(command: string): Promise<any> {
        return this._sendRequest({
            type: 'command',
            command: command
        });
    }

    /**
     * Placeholder değerini al
     * @param placeholder Placeholder
     * @param player Oyuncu adı (opsiyonel)
     * @returns Yanıt Promise'i
     */
    public parsePlaceholder(placeholder: string, player?: string): Promise<any> {
        const request: any = {
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
     * @param player Oyuncu adı
     * @returns Yanıt Promise'i
     */
    public isPlayerOnline(player: string): Promise<any> {
        return this._sendRequest({
            type: 'isPlayerOnline',
            player: player
        });
    }

    /**
     * Çevrimiçi oyuncuları al
     * @returns Yanıt Promise'i
     */
    public getOnlinePlayers(): Promise<any> {
        return this._sendRequest({
            type: 'getOnlinePlayers'
        });
    }

    /**
     * Sunucu bilgilerini al
     * @returns Yanıt Promise'i
     */
    public getServerInfo(): Promise<any> {
        return this._sendRequest({
            type: 'getServerInfo'
        });
    }
} 