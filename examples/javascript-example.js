/**
 * CWebSender JavaScript Client Example
 * 
 * Bu örnek, CWebSender JavaScript istemcisinin nasıl kullanılacağını gösterir.
 * Aşağıdaki komutlarla çalıştırılabilir:
 * node javascript-example.js
 * 
 * Gereksinimler:
 * - Node.js
 * - ws paketi (npm install ws)
 */

// İstemci sınıfını içe aktar
const { CWebSenderClient } = require('../clients/CWebSender.js');
const path = require('path');
const fs = require('fs');

// Özel anahtarın yolu
const privateKeyPath = path.join(__dirname, 'private_key.pem');

// İstemci yapılandırması
const config = {
    serverUrl: 'ws://localhost:8080/cwebsender',
    privateKeyPath: privateKeyPath,  // Özel anahtar dosyasının yolu
    // Alternatif olarak, özel anahtarı doğrudan sağlayabilirsiniz:
    // privateKey: '-----BEGIN PRIVATE KEY-----\n...ÖZEL ANAHTARINIZ...\n-----END PRIVATE KEY-----',
    timeout: 30000,  // 30 saniye zaman aşımı
    reconnect: true,  // Bağlantı kesilirse otomatik olarak yeniden bağlan
    reconnectInterval: 5000,  // 5 saniyede bir yeniden bağlanmayı dene
    maxReconnects: 10,  // En fazla 10 kez yeniden bağlanmayı dene
    debug: true  // Debug mesajlarını etkinleştir
};

// Bu örnek, private_key.pem dosyasının mevcut olup olmadığını kontrol eder
// Gerçek uygulamalarda, güvenliği sağlamak için kendi özel anahtarınızı kullanmalısınız
function ensurePrivateKeyExists() {
    if (!fs.existsSync(privateKeyPath)) {
        console.log('Örnek özel anahtar oluşturuluyor...');
        // Bu sadece örneklerde kullanım içindir, gerçek uygulamalarda özel anahtarınızı güvenli bir şekilde oluşturun
        const crypto = require('crypto');
        const { privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        
        fs.writeFileSync(privateKeyPath, privateKey);
        console.log(`Örnek özel anahtar şuraya kaydedildi: ${privateKeyPath}`);
        console.log('NOT: Bu sadece örnek amaçlıdır. Gerçek uygulamada, sunucuya kaydedilmiş gerçek anahtarı kullanmalısınız.');
    }
}

// İstemci oluştur ve bağlan
async function connectAndUse() {
    try {
        ensurePrivateKeyExists();
        
        // İstemciyi oluştur
        const client = new CWebSenderClient(config);
        
        // Event listener'ları ekle
        client.on('open', () => console.log('Bağlantı açıldı'));
        client.on('close', (data) => console.log(`Bağlantı kapandı: ${data.reason}`));
        client.on('error', (data) => console.error(`Hata: ${data.message}`));
        client.on('auth_success', () => console.log('Kimlik doğrulama başarılı'));
        client.on('auth_failure', (error) => console.error(`Kimlik doğrulama başarısız: ${error}`));
        
        // Bağlan
        await client.connect();
        
        console.log('Bağlantı başarılı!');
        
        try {
            // Komut çalıştır (sadece yetkili ise çalışır)
            const commandResult = await client.executeCommand('say Merhaba, CWebSender!');
            console.log('Komut yanıtı:', commandResult);
            
            // PlaceholderAPI değeri al (yüklü ise)
            const placeholderResult = await client.parsePlaceholder('%server_online%');
            console.log('Çevrimiçi oyuncu sayısı:', placeholderResult.value);
            
            // Çevrimiçi oyuncuları al
            const onlinePlayers = await client.getOnlinePlayers();
            console.log('Çevrimiçi oyuncular:', onlinePlayers.players);
            
            // Sunucu bilgilerini al
            const serverInfo = await client.getServerInfo();
            console.log('Sunucu bilgisi:', serverInfo);
            
            // Belirli bir oyuncunun çevrimiçi olup olmadığını kontrol et
            if (onlinePlayers.players && onlinePlayers.players.length > 0) {
                const playerName = onlinePlayers.players[0];
                const playerStatus = await client.isPlayerOnline(playerName);
                console.log(`${playerName} çevrimiçi mi? ${playerStatus.online ? 'Evet' : 'Hayır'}`);
            }
        } catch (error) {
            console.error('İstek hatası:', error.message);
        }
        
        // 10 saniye bekledikten sonra bağlantıyı kapat
        console.log('10 saniye sonra bağlantı kapatılacak...');
        setTimeout(() => {
            client.disconnect();
            console.log('Bağlantı kapatıldı');
        }, 10000);
        
    } catch (error) {
        console.error('Bağlantı hatası:', error.message);
    }
}

// Fonksiyonu çalıştır
connectAndUse().catch(err => console.error('Ana hata:', err.message));

// Diğer bir kullanım şekli: Promise'ler yerine callback'ler kullanarak:
function exampleWithCallbacks() {
    const clientWithUrl = new CWebSenderClient('ws://localhost:8080/cwebsender', {
        privateKeyPath: privateKeyPath
    });
    
    clientWithUrl.on('auth_success', () => {
        console.log('Callback örneği: Kimlik doğrulama başarılı');
        
        // Komut çalıştırma örneği
        clientWithUrl.executeCommand('time set day')
            .then(result => console.log('Gün oldu!', result))
            .catch(err => console.error('Komut çalıştırma hatası:', err.message));
    });
    
    clientWithUrl.on('auth_failure', (error) => {
        console.error('Callback örneği: Kimlik doğrulama başarısız:', error);
    });
    
    clientWithUrl.connect()
        .then(() => console.log('Callback örneği: Bağlantı başarılı'))
        .catch(err => console.error('Callback örneği: Bağlantı hatası:', err.message));
}

// Bu ikinci örneği yorum satırından çıkarıp kullanabilirsiniz:
// exampleWithCallbacks();

/**
 * CWebSender İstemci Kullanım İpuçları:
 * 
 * 1. Doğru Kimlik Doğrulama: İstemci, sunucuda yapılandırılmış RSA anahtar çiftiyle eşleşen
 *    özel anahtarınızla kimlik doğrulaması yapmalıdır. Bu örnek için rastgele bir anahtar oluşturuyoruz,
 *    ancak gerçek uygulamalarda sunucuya kaydedilmiş anahtarı kullanmalısınız.
 * 
 * 2. Reconnect Stratejisi: İstemci, ağ kesintileri durumunda otomatik olarak yeniden bağlanacaktır.
 *    Yapılandırma sırasında reconnect, reconnectInterval ve maxReconnects parametrelerini ayarlayabilirsiniz.
 * 
 * 3. Ping/Pong: İstemci, bağlantıyı canlı tutmak için otomatik olarak ping mesajları gönderir.
 * 
 * 4. Hata İşleme: Tüm istekler Promise döndürür ve try/catch blokları içinde işlenebilir.
 * 
 * 5. Event Listener'lar: Bağlantı durumu değişikliklerini izlemek için open, close, error, auth_success
 *    ve auth_failure event'lerine listener ekleyebilirsiniz.
 */ 