# CWebSender API

CWebSender, Minecraft sunucunuzu uzaktan yönetmek için WebSocket tabanlı bir API kütüphanesidir. Bu kütüphane sayesinde Minecraft sunucunuzda komut çalıştırabilir, PlaceholderAPI değerlerini alabilir, oyuncu durumunu kontrol edebilir ve daha fazlasını yapabilirsiniz.

## Özellikler

- WebSocket üzerinden gerçek zamanlı bağlantı
- RSA-2048 anahtar çifti tabanlı güvenli kimlik doğrulama
- Komut çalıştırma
- PlaceholderAPI desteği
- Oyuncu durumu kontrolü
- Çevrimiçi oyuncu listesi
- Sunucu bilgilerini alma
- Otomatik yeniden bağlanma
- Ping-pong mekanizması ile bağlantı durumu kontrolü
- Olay tabanlı mimari
- Promise tabanlı API
- Kapsamlı hata yönetimi ve loglama

## Detaylı Kullanım Örnekleri

### JavaScript Örneği

JavaScript istemci örneği için `examples/javascript-example.js` dosyasını inceleyebilirsiniz. Bu dosya, Node.js ortamında çalıştırılabilir ve CWebSender istemcisinin temel kullanımını gösterir.

### PHP Örneği

PHP istemci örneği için `examples/php-example.php` dosyasını inceleyebilirsiniz. Bu dosya, PHP ortamında çalıştırılabilir ve CWebSender istemcisinin temel kullanımını gösterir.

### TypeScript Örneği

TypeScript istemci örneği için `examples/typescript-example.ts` dosyasını inceleyebilirsiniz. Bu dosya, Node.js ortamında çalıştırılabilir ve CWebSender istemcisinin TypeScript ile kullanımını gösterir.

## Güvenlik

CWebSender, güvenli iletişim için RSA-2048 anahtar çifti tabanlı bir kimlik doğrulama sistemi kullanır:

1. Sunucu, kendi dizininde bir `public.key` ve `private.key` oluşturur
2. İstemci, sunucuya bağlandığında sunucu bir challenge (nonce) gönderir
3. İstemci, bu challenge'ı kendi private key'i ile imzalar ve sunucuya gönderir
4. Sunucu, imzayı istemcinin public key'i ile doğrular

Bu sistem, token tabanlı sistemlerden daha güvenlidir çünkü:
- Private key asla ağ üzerinden gönderilmez
- Her bağlantı için benzersiz bir challenge kullanılır
- Replay saldırılarına karşı koruma sağlar

## İpuçları ve En İyi Uygulamalar

1. **SSL Kullanın**: Üretim ortamında her zaman `wss://` protokolünü kullanın (WebSocket Secure).

2. **Komut Önbelleği**: Sık kullanılan komutları önbelleğe alarak performansı artırın:
   ```javascript
   const commandCache = new Map();
   
   async function cachedCommand(command, maxAge = 30000) {
       const now = Date.now();
       const cacheKey = command;
       
       if (commandCache.has(cacheKey)) {
           const cached = commandCache.get(cacheKey);
           if (now - cached.timestamp < maxAge) {
               console.log('Önbellekten komut sonucu kullanılıyor');
               return cached.result;
           }
       }
       
       const result = await client.executeCommand(command);
       commandCache.set(cacheKey, { result, timestamp: now });
       return result;
   }
   ```

3. **İstek Kuyruğu**: Çok sayıda isteği sıra ile gönderin:
   ```javascript
   const requestQueue = [];
   let processing = false;
   
   function queueRequest(requestFn) {
       return new Promise((resolve, reject) => {
           requestQueue.push({ requestFn, resolve, reject });
           processQueue();
       });
   }
   
   async function processQueue() {
       if (processing || requestQueue.length === 0) return;
       
       processing = true;
       const { requestFn, resolve, reject } = requestQueue.shift();
       
       try {
           const result = await requestFn();
           resolve(result);
       } catch (error) {
           reject(error);
       } finally {
           processing = false;
           processQueue();
       }
   }
   
   // Kullanım
   queueRequest(() => client.executeCommand('say İlk'))
       .then(result => console.log('İlk komut:', result));
       
   queueRequest(() => client.executeCommand('say İkinci'))
       .then(result => console.log('İkinci komut:', result));
   ```

4. **Otomatik Yeniden Bağlanma**: Bağlantı kesildiğinde otomatik yeniden bağlanma mantığını geliştirin:
   ```javascript
   let reconnectTimer = null;
   
   client.on('close', (event) => {
       console.log(`Bağlantı kapandı: ${event.code} - ${event.reason}`);
       
       if (reconnectTimer) clearTimeout(reconnectTimer);
       
       reconnectTimer = setTimeout(async () => {
           console.log('Yeniden bağlanılıyor...');
           try {
               await client.connect();
               console.log('Başarıyla yeniden bağlandı!');
           } catch (error) {
               console.error('Yeniden bağlanma hatası:', error.message);
           }
       }, 5000);
   });
   ```

## Notlar ve Kısıtlamalar

- Node.js ortamında çalıştırırken `ws` ve `crypto` modüllerinin yüklü olması gerekir.
- WebSocket sunucusunun SLL (wss://) kullanması tavsiye edilir.
- Private key'in güvenli bir şekilde saklandığından emin olun.
- Otomatik yeniden bağlanma maksimum 10 deneme ile sınırlıdır.
- Ping-pong sistemi ile bağlantı durumu her 30 saniyede bir kontrol edilir.

## Hata Çözümleri

1. **Bağlantı Hatası (WebSocket error: Connection refused)**
   - Sunucu çalışıyor mu?
   - Port doğru mu?
   - Firewall bağlantıyı engelliyor mu?

2. **Kimlik Doğrulama Başarısız (Invalid signature)**
   - Private key doğru mu?
   - Key formatı destekleniyor mu?
   - Sunucudaki public key ile eşleşiyor mu?

3. **İstek Zaman Aşımı (Request timed out)**
   - Sunucu yanıt veriyor mu?
   - Timeout süresi yeterli mi?
   - Sunucu yoğun olabilir mi?

4. **Anormal Bağlantı Kapanması (Code: 1006)**
   - Ağ bağlantısını kontrol edin
   - Sunucu çökmüş olabilir
   - Proxy veya firewall sorunları olabilir
