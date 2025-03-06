/**
 * CWebSender TypeScript Client Example
 * 
 * Bu örnek, CWebSender TypeScript istemcisinin nasıl kullanılacağını gösterir.
 * Aşağıdaki komutlarla çalıştırılabilir (derlendikten sonra):
 * npm install --save-dev typescript ts-node @types/node @types/ws
 * npx ts-node typescript-example.ts
 * 
 * Gereksinimler:
 * - Node.js
 * - TypeScript
 * - ws paketi ve @types/ws (npm install ws @types/ws)
 */

// İstemci sınıfını içe aktar
import { CWebSenderClient } from '../clients/CWebSender';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

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

// Response arayüzleri
interface CommandResponse {
    id: string;
    type: string;
    success: boolean;
    message?: string;
}

interface PlaceholderResponse {
    id: string;
    type: string;
    placeholder: string;
    value: string;
    player?: string;
}

interface OnlinePlayersResponse {
    id: string;
    type: string;
    players: string[];
    count: number;
}

interface ServerInfoResponse {
    id: string;
    type: string;
    name: string;
    version: string;
    online: number;
    max: number;
    tps: number;
    motd: string;
}

// Bu örnek, private_key.pem dosyasının mevcut olup olmadığını kontrol eder
// Gerçek uygulamalarda, güvenliği sağlamak için kendi özel anahtarınızı kullanmalısınız
function ensurePrivateKeyExists(): void {
    if (!fs.existsSync(privateKeyPath)) {
        console.log('Örnek özel anahtar oluşturuluyor...');
        // Bu sadece örneklerde kullanım içindir, gerçek uygulamalarda özel anahtarınızı güvenli bir şekilde oluşturun
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
async function connectAndUse(): Promise<void> {
    try {
        ensurePrivateKeyExists();
        
        // İstemciyi oluştur
        const client = new CWebSenderClient(config);
        
        // Event listener'ları ekle
        client.on('open', () => console.log('Bağlantı açıldı'));
        client.on('close', (data?: any) => console.log(`Bağlantı kapandı: ${data?.reason || 'Bilinmeyen neden'}`));
        client.on('error', (data?: any) => console.error(`Hata: ${data?.message || 'Bilinmeyen hata'}`));
        client.on('auth_success', () => console.log('Kimlik doğrulama başarılı'));
        client.on('auth_failure', (error?: any) => console.error(`Kimlik doğrulama başarısız: ${error || 'Bilinmeyen hata'}`));
        
        // Bağlan
        await client.connect();
        
        console.log('Bağlantı başarılı!');
        
        try {
            // Komut çalıştır (sadece yetkili ise çalışır)
            const commandResult = await client.executeCommand('say Merhaba, TypeScript CWebSender!') as CommandResponse;
            console.log('Komut yanıtı:', commandResult);
            
            // PlaceholderAPI değeri al (yüklü ise)
            const placeholderResult = await client.parsePlaceholder('%server_online%') as PlaceholderResponse;
            console.log('Çevrimiçi oyuncu sayısı:', placeholderResult.value);
            
            // Çevrimiçi oyuncuları al
            const onlinePlayers = await client.getOnlinePlayers() as OnlinePlayersResponse;
            console.log('Çevrimiçi oyuncular:', onlinePlayers.players);
            console.log('Toplam oyuncu sayısı:', onlinePlayers.count);
            
            // Sunucu bilgilerini al
            const serverInfo = await client.getServerInfo() as ServerInfoResponse;
            console.log('Sunucu bilgisi:');
            console.log(`  Ad: ${serverInfo.name}`);
            console.log(`  Versiyon: ${serverInfo.version}`);
            console.log(`  Oyuncular: ${serverInfo.online}/${serverInfo.max}`);
            console.log(`  TPS: ${serverInfo.tps}`);
            console.log(`  MOTD: ${serverInfo.motd}`);
            
            // Belirli bir oyuncunun çevrimiçi olup olmadığını kontrol et
            if (onlinePlayers.players && onlinePlayers.players.length > 0) {
                const playerName = onlinePlayers.players[0];
                const playerStatus = await client.isPlayerOnline(playerName);
                console.log(`${playerName} çevrimiçi mi? ${playerStatus.online ? 'Evet' : 'Hayır'}`);
            }
        } catch (error) {
            console.error('İstek hatası:', error instanceof Error ? error.message : error);
        }
        
        // 10 saniye bekledikten sonra bağlantıyı kapat
        console.log('10 saniye sonra bağlantı kapatılacak...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        client.disconnect();
        console.log('Bağlantı kapatıldı');
        
    } catch (error) {
        console.error('Bağlantı hatası:', error instanceof Error ? error.message : error);
    }
}

// Fonksiyonu çalıştır
connectAndUse().catch(err => console.error('Ana hata:', err instanceof Error ? err.message : err));

/**
 * CWebSender TypeScript İstemci Kullanım İpuçları:
 * 
 * 1. TypeScript'in Tip Güvenliği: TypeScript, tam olarak tipli programlamayı destekler. 
 *    API'den dönen yanıtların türünü daha iyi tanımlamak için arayüzler oluşturabilirsiniz.
 * 
 * 2. async/await veya Promise Zinciri: İstemcinin tüm metodları Promise döndürür,
 *    bu nedenle async/await veya Promise zincirleme kullanabilirsiniz.
 * 
 * 3. Node.js ve Browser Desteği: İstemci hem Node.js hem de tarayıcı ortamlarında çalışacak
 *    şekilde tasarlanmıştır. Tarayıcıda kullanırken gerekli modülleri bundle etmelisiniz.
 * 
 * 4. Hata Yakalama: Her Promise'in .catch() işleyicisine sahip olduğundan veya bir try-catch
 *    bloğu içinde await edildiğinden emin olun.
 * 
 * 5. Event Listener'lar: Bağlantının durumunu izlemek için event listener'ları kullanabilirsiniz.
 *    İstemci, 'open', 'close', 'error', 'auth_success' ve 'auth_failure' gibi olayları destekler.
 */ 