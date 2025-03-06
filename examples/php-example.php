<?php
/**
 * CWebSender PHP Client Example
 * 
 * Bu örnek, CWebSender PHP istemcisinin nasıl kullanılacağını gösterir.
 * Aşağıdaki komutlarla çalıştırılabilir:
 * php php-example.php
 * 
 * Gereksinimler:
 * - PHP 7.3+
 * - OpenSSL Extension
 * - WebSocket istemcisi için "textalk/websocket" paketi
 *   Kurulum: composer require textalk/websocket
 */

// Composer'ı kullanacaksanız açın:
// require 'vendor/autoload.php';

// CWebSenderClient'ı dahil et
require '../clients/CWebSender.php';

// Özel anahtarın yolu
$privateKeyPath = __DIR__ . '/private_key.pem';

// İstemci yapılandırması
$config = [
    'serverUrl' => 'ws://localhost:8080/cwebsender',
    'privateKeyPath' => $privateKeyPath,  // Özel anahtar dosyasının yolu
    // Alternatif olarak, özel anahtarı doğrudan sağlayabilirsiniz:
    // 'privateKey' => "-----BEGIN PRIVATE KEY-----\n...ÖZEL ANAHTARINIZ...\n-----END PRIVATE KEY-----",
    'timeout' => 30000,  // 30 saniye zaman aşımı
    'reconnect' => true,  // Bağlantı kesilirse otomatik olarak yeniden bağlan
    'reconnectInterval' => 5000,  // 5 saniyede bir yeniden bağlanmayı dene
    'maxReconnects' => 10  // En fazla 10 kez yeniden bağlanmayı dene
];

// Bu örnek, private_key.pem dosyasının mevcut olup olmadığını kontrol eder
// Gerçek uygulamalarda, güvenliği sağlamak için kendi özel anahtarınızı kullanmalısınız
function ensurePrivateKeyExists($privateKeyPath) {
    if (!file_exists($privateKeyPath)) {
        echo "Örnek özel anahtar oluşturuluyor...\n";
        // Bu sadece örneklerde kullanım içindir, gerçek uygulamalarda özel anahtarınızı güvenli bir şekilde oluşturun
        $config = [
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];
        
        $res = openssl_pkey_new($config);
        
        if (!$res) {
            echo "Anahtar oluşturulamadı: " . openssl_error_string() . "\n";
            return false;
        }
        
        openssl_pkey_export($res, $privateKey);
        file_put_contents($privateKeyPath, $privateKey);
        
        echo "Örnek özel anahtar şuraya kaydedildi: $privateKeyPath\n";
        echo "NOT: Bu sadece örnek amaçlıdır. Gerçek uygulamada, sunucuya kaydedilmiş gerçek anahtarı kullanmalısınız.\n";
    }
    
    return true;
}

// PHP'de oluşturulan anahtarın doğruluğunu test et
function testKey($privateKeyPath) {
    $privateKey = file_get_contents($privateKeyPath);
    $testData = "Test veri";
    $signature = null;
    
    // Özel anahtarla imzala
    if (!openssl_sign($testData, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
        echo "İmzalama hatası: " . openssl_error_string() . "\n";
        return false;
    }
    
    echo "Anahtar testi başarılı.\n";
    return true;
}

// Başarılı yanıt callback'i
function onSuccess($response) {
    echo "İşlem başarılı: " . json_encode($response) . "\n";
}

// Hata callback'i
function onError($error) {
    echo "Hata: $error\n";
}

// Event listener örneği
function onOpen() {
    echo "Bağlantı açıldı!\n";
}

// Event listener örneği
function onAuthSuccess() {
    echo "Kimlik doğrulama başarılı!\n";
}

// Event listener örneği
function onClose($data) {
    echo "Bağlantı kapandı: " . $data['reason'] . "\n";
}

// Ana örnek fonksiyon
function runExample() {
    global $config, $privateKeyPath;
    
    if (!ensurePrivateKeyExists($privateKeyPath) || !testKey($privateKeyPath)) {
        echo "Anahtar oluşturma veya test etme başarısız, çıkılıyor.\n";
        return;
    }
    
    // İstemciyi oluştur
    $client = new CWebSenderClient($config);
    
    // Event listener'ları ekle
    $client->on('open', 'onOpen');
    $client->on('auth_success', 'onAuthSuccess');
    $client->on('close', 'onClose');
    
    try {
        // Bağlan
        if ($client->connect()) {
            echo "Bağlantı başarılı!\n";
            
            // Komut çalıştır
            $client->executeCommand('say Merhaba, PHP CWebSender!', 'onSuccess', 'onError');
            
            // PlaceholderAPI değeri al
            $client->parsePlaceholder('%server_online%', null, 'onSuccess', 'onError');
            
            // Çevrimiçi oyuncuları al
            $client->getOnlinePlayers(function($response) {
                echo "Çevrimiçi oyuncular: " . implode(', ', $response['players']) . "\n";
            }, 'onError');
            
            // Sunucu bilgilerini al
            $client->getServerInfo(function($response) {
                echo "Sunucu adı: " . $response['name'] . "\n";
                echo "Versiyon: " . $response['version'] . "\n";
                echo "Çevrimiçi oyuncu sayısı: " . $response['online'] . "/" . $response['max'] . "\n";
            }, 'onError');
            
            // WebSocket mesajlarının işlenmesine olanak sağlamak için kısa bir bekleme
            // Gerçek uygulamada, WebSocket bağlantısını event loop içinde yönetmelisiniz
            echo "Mesajları işlemek için 5 saniye bekleniyor... (Gerçek uygulamada event loop kullanılmalıdır)\n";
            sleep(5);
            
            // Bağlantıyı kapat
            $client->disconnect();
            echo "Bağlantı kapatıldı.\n";
        } else {
            echo "Bağlantı başarısız.\n";
        }
    } catch (Exception $e) {
        echo "Hata: " . $e->getMessage() . "\n";
    }
}

// Örneği çalıştır
runExample();

/**
 * CWebSender PHP İstemci Kullanım İpuçları:
 * 
 * 1. WebSocket İşleme: PHP, JavaScript gibi olay tabanlı bir dil değildir. WebSocket bağlantısını
 *    etkin bir şekilde yönetmek için ReactPHP veya Swoole gibi asenkron I/O kütüphanelerini
 *    kullanmayı düşünmelisiniz.
 * 
 * 2. Callback Yaklaşımı: PHP'de Promise'ler yerine callback'ler kullanılmaktadır. Her metod,
 *    $resolve ve $reject callback'lerini parametre olarak alır.
 * 
 * 3. Event Loop Gerekliliği: WebSocket'leri uzun süreli dinlemek için bir event loop gereklidir.
 *    Bu örnek, sadece gösterim amaçlıdır ve sleep() kullanarak basitleştirilmiştir.
 * 
 * 4. Kimlik Doğrulama: İstemci, sunucuda yapılandırılmış RSA anahtar çiftiyle eşleşen
 *    özel anahtarla kimlik doğrulaması yapmalıdır.
 *
 * 5. Örnek Deployment: Bir web uygulamasında bu istemciyi kullanırken, WebSocket işlemlerini
 *    arka planda çalışan ayrı bir süreç olarak yönetmeniz önerilir.
 */
?> 