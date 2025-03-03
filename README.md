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


## Basit Kullanım

```javascript
// CWebSender istemcisini oluştur
const client = new CWebSenderClient({
    serverUrl: 'ws://localhost:8080/websender',
    privateKeyPath: './private.key',  // Node.js için
    // privateKey: '...base64 encoded private key...'  // Tarayıcı için
    timeout: 30000,                   // İstek zaman aşımı (ms)
    reconnect: true,                  // Otomatik yeniden bağlanma
    reconnectInterval: 5000,          // Yeniden bağlanma aralığı (ms)
    maxReconnects: 10,                // Maksimum yeniden bağlanma denemesi
    pingInterval: 30000               // Ping gönderme aralığı (ms)
});

// Bağlantı olaylarını dinle
client.on('open', () => {
    console.log('Bağlantı kuruldu!');
});

client.on('auth_success', async () => {
    console.log('Kimlik doğrulama başarılı!');
    
    try {
        // Komut çalıştır
        const commandResponse = await client.executeCommand('say Merhaba Dünya!');
        console.log('Komut yanıtı:', commandResponse);
        
        // Placeholder değeri al
        const placeholderResponse = await client.parsePlaceholder('%server_online%');
        console.log('Çevrimiçi oyuncu sayısı:', placeholderResponse.value);
        
        // Oyuncu durumunu kontrol et
        const playerStatus = await client.isPlayerOnline('Steve');
        console.log('Steve çevrimiçi mi:', playerStatus.online);
        
        // Çevrimiçi oyuncuları al
        const onlinePlayers = await client.getOnlinePlayers();
        console.log('Çevrimiçi oyuncular:', onlinePlayers.players);
        
        // Sunucu bilgilerini al
        const serverInfo = await client.getServerInfo();
        console.log('Sunucu bilgileri:', serverInfo);
    } catch (error) {
        console.error('Hata:', error.message);
    }
});

client.on('auth_failure', (error) => {
    console.error('Kimlik doğrulama başarısız:', error);
});

client.on('error', (error) => {
    console.error('Bağlantı hatası:', error);
});

client.on('close', (event) => {
    console.log('Bağlantı kapandı:', event);
});

// Bağlantıyı başlat
client.connect()
    .then(() => {
        console.log('Bağlantı başarılı!');
    })
    .catch(error => {
        console.error('Bağlantı hatası:', error.message);
    });
```

## Detaylı Kullanım Örnekleri

### 1. Bağlantı ve Kimlik Doğrulama

```javascript
// İstemciyi oluştur
const client = new CWebSenderClient({
    serverUrl: 'ws://localhost:8080/websender',
    privateKeyPath: './private.key',
    timeout: 30000,                // İstek zaman aşımı (ms)
    reconnect: true,               // Otomatik yeniden bağlanma
    reconnectInterval: 5000,       // Yeniden bağlanma aralığı (ms)
    maxReconnects: 10,             // Maksimum yeniden bağlanma denemesi
    pingInterval: 30000            // Ping gönderme aralığı (ms)
});

// Bağlantı olaylarını dinle
client.on('open', () => {
    console.log('WebSocket bağlantısı açıldı');
});

client.on('auth_success', () => {
    console.log('Kimlik doğrulama başarılı, artık komut gönderebilirsiniz');
});

client.on('auth_failure', (error) => {
    console.error('Kimlik doğrulama başarısız:', error);
});

client.on('close', (event) => {
    console.log(`Bağlantı kapandı: Kod ${event.code}, Neden: ${event.reason}`);
});

client.on('error', (error) => {
    console.error('WebSocket hatası:', error.message);
});

// Bağlantıyı başlat
client.connect()
    .then(() => console.log('Bağlantı ve kimlik doğrulama tamamlandı'))
    .catch(error => console.error('Bağlantı hatası:', error.message));
```

### 2. Komut Çalıştırma

```javascript
// Tek bir komut çalıştır
client.executeCommand('say Merhaba Sunucu!')
    .then(response => {
        console.log('Komut başarıyla çalıştırıldı');
        console.log('Yanıt:', response.message);
    })
    .catch(error => {
        console.error('Komut çalıştırma hatası:', error.message);
    });

// Birden fazla komut çalıştır
async function runMultipleCommands() {
    try {
        await client.executeCommand('say İlk komut');
        console.log('İlk komut çalıştırıldı');
        
        await client.executeCommand('weather clear');
        console.log('Hava temizlendi');
        
        const timeResponse = await client.executeCommand('time set day');
        console.log('Zaman ayarlandı:', timeResponse.message);
    } catch (error) {
        console.error('Komut çalıştırma hatası:', error.message);
    }
}

runMultipleCommands();
```

### 3. PlaceholderAPI Kullanımı

```javascript
// Sunucu placeholderları
client.parsePlaceholder('%server_online%')
    .then(response => {
        console.log('Çevrimiçi oyuncu sayısı:', response.value);
    })
    .catch(error => {
        console.error('Placeholder hatası:', error.message);
    });

// Oyuncu placeholderları
client.parsePlaceholder('%player_health%', 'Steve')
    .then(response => {
        console.log('Steve\'in canı:', response.value);
    })
    .catch(error => {
        console.error('Placeholder hatası:', error.message);
    });

// Birden fazla placeholder
async function getPlayerStats(playerName) {
    try {
        const health = await client.parsePlaceholder('%player_health%', playerName);
        const food = await client.parsePlaceholder('%player_food_level%', playerName);
        const exp = await client.parsePlaceholder('%player_exp%', playerName);
        
        console.log(`${playerName} istatistikleri:`);
        console.log(`- Can: ${health.value}`);
        console.log(`- Açlık: ${food.value}`);
        console.log(`- Tecrübe: ${exp.value}`);
    } catch (error) {
        console.error('Placeholder hatası:', error.message);
    }
}

getPlayerStats('Steve');
```

### 4. Oyuncu Durumu Kontrolü

```javascript
// Oyuncunun çevrimiçi olup olmadığını kontrol et
client.isPlayerOnline('Steve')
    .then(response => {
        if (response.online) {
            console.log('Steve şu anda çevrimiçi!');
        } else {
            console.log('Steve çevrimiçi değil');
        }
    })
    .catch(error => {
        console.error('Durum kontrolü hatası:', error.message);
    });

// Çevrimiçi oyuncuları al
client.getOnlinePlayers()
    .then(response => {
        console.log('Çevrimiçi oyuncular:', response.players);
        console.log('Toplam çevrimiçi oyuncu:', response.players.length);
        
        // Her oyuncu için işlem yap
        response.players.forEach(player => {
            console.log(`- ${player}`);
        });
    })
    .catch(error => {
        console.error('Oyuncu listesi hatası:', error.message);
    });
```

### 5. Sunucu Bilgilerini Alma

```javascript
client.getServerInfo()
    .then(info => {
        console.log('Sunucu Bilgileri:');
        console.log(`- İsim: ${info.name}`);
        console.log(`- Sürüm: ${info.version}`);
        console.log(`- MOTD: ${info.motd}`);
        console.log(`- Çevrimiçi: ${info.online}/${info.maxPlayers}`);
        console.log(`- TPS: ${info.tps}`);
        console.log(`- Dünya: ${info.world}`);
    })
    .catch(error => {
        console.error('Sunucu bilgileri hatası:', error.message);
    });
```

### 6. Olay Dinleme

```javascript
// Oyuncu giriş olayını dinle
client.on('player_join', (data) => {
    console.log(`${data.player} sunucuya katıldı!`);
    
    // Hoş geldin mesajı gönder
    client.executeCommand(`tell ${data.player} Hoş geldin!`)
        .catch(error => console.error('Komut hatası:', error.message));
});

// Oyuncu çıkış olayını dinle
client.on('player_quit', (data) => {
    console.log(`${data.player} sunucudan ayrıldı!`);
});

// Komut çalıştırma olayını dinle
client.on('command_executed', (data) => {
    console.log(`${data.player || 'Konsol'} tarafından komut çalıştırıldı: ${data.command}`);
});
```

### 7. Bağlantıyı Kapatma

```javascript
// Bağlantıyı kapat
client.disconnect()
    .then(() => {
        console.log('Bağlantı başarıyla kapatıldı');
    })
    .catch(error => {
        console.error('Bağlantı kapatma hatası:', error.message);
    });
    
// veya
async function closeConnection() {
    try {
        await client.disconnect();
        console.log('Bağlantı başarıyla kapatıldı');
    } catch (error) {
        console.error('Bağlantı kapatma hatası:', error.message);
    }
}

closeConnection();
```

### 8. Hata Yönetimi ve Yeniden Bağlanma

```javascript
// Daha gelişmiş hata yönetimi
client.on('error', (error) => {
    console.error('Bağlantı hatası:', error.message);
    // Logu kaydet, yöneticiye bildir, vb.
});

client.on('close', (event) => {
    if (event.code === 1006) {
        console.error('Anormal bağlantı kapanması, yeniden bağlanmayı bekleyin');
    } else if (event.code === 1000) {
        console.log('Bağlantı normal şekilde kapatıldı');
    }
});

// Yeniden bağlanma durumunu izleme
let reconnectCount = 0;
client.on('open', () => {
    if (reconnectCount > 0) {
        console.log(`Bağlantı başarıyla yeniden kuruldu (${reconnectCount}. deneme)`);
        reconnectCount = 0;
    }
});

// Manuel yeniden bağlanma fonksiyonu
async function reconnect() {
    try {
        console.log('Manuel olarak yeniden bağlanılıyor...');
        await client.disconnect();
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 saniye bekle
        await client.connect();
        console.log('Manuel yeniden bağlanma başarılı!');
    } catch (error) {
        console.error('Manuel yeniden bağlanma hatası:', error.message);
    }
}
```

### 9. WebSocket Mesaj Trafiğini Görüntüleme

```javascript
// Her gelen ve giden mesajı görmek için bu yardımcı fonksiyonu kullanabilirsiniz
// Not: Hassas bilgileri göstermekten kaçınır

// Websocket'in orijinal metodlarını koru
const originalSend = client.ws.send;
const originalOnMessage = client.ws.onmessage;

// Giden mesajları logla
client.ws.send = function(data) {
    try {
        const message = JSON.parse(data);
        // Hassas bilgileri filtrele
        if (message.type === 'authResponse' && message.signature) {
            message.signature = '***FILTERED***';
        }
        console.log('→ GÖNDER:', message);
    } catch (e) {
        console.log('→ GÖNDER: (JSON olmayan veri)');
    }
    return originalSend.apply(this, arguments);
};

// Gelen mesajları logla
client.ws.onmessage = function(event) {
    try {
        const message = JSON.parse(event.data);
        // Hassas bilgileri filtrele
        if ((message.type === 'authChallenge' && message.nonce) || 
            (message.type === 'authResponse' && message.signature)) {
            const filtered = {...message};
            if (filtered.nonce) filtered.nonce = '***FILTERED***';
            if (filtered.signature) filtered.signature = '***FILTERED***';
            console.log('← AL:', filtered);
        } else {
            console.log('← AL:', message);
        }
    } catch (e) {
        console.log('← AL: (JSON olmayan veri)');
    }
    return originalOnMessage.apply(this, arguments);
};
```

## API Referansı

### Yapılandırma Seçenekleri

| Seçenek | Tür | Varsayılan | Açıklama |
|---------|-----|------------|----------|
| `serverUrl` | String | - | WebSocket sunucu URL'si (zorunlu) |
| `privateKey` | String | - | Base64 kodlanmış private key |
| `privateKeyPath` | String | - | Private key dosyasının yolu (Node.js) |
| `timeout` | Number | 30000 | İstek zaman aşımı (ms) |
| `reconnect` | Boolean | true | Otomatik yeniden bağlanma |
| `reconnectInterval` | Number | 5000 | Yeniden bağlanma aralığı (ms) |
| `maxReconnects` | Number | 10 | Maksimum yeniden bağlanma denemesi |
| `pingInterval` | Number | 30000 | Ping gönderme aralığı (ms) |

### Metodlar

| Metod | Parametreler | Dönüş | Açıklama |
|-------|-------------|-------|----------|
| `connect()` | - | Promise | WebSocket bağlantısı kurar |
| `disconnect()` | - | Promise | WebSocket bağlantısını kapatır |
| `executeCommand(command)` | command: String | Promise | Komut çalıştırır |
| `parsePlaceholder(placeholder, player)` | placeholder: String, player: String (opsiyonel) | Promise | Placeholder değerini alır |
| `isPlayerOnline(player)` | player: String | Promise | Oyuncunun çevrimiçi olup olmadığını kontrol eder |
| `getOnlinePlayers()` | - | Promise | Çevrimiçi oyuncuları alır |
| `getServerInfo()` | - | Promise | Sunucu bilgilerini alır |
| `on(event, callback)` | event: String, callback: Function | this | Olay dinleyicisi ekler |
| `off(event, callback)` | event: String, callback: Function | this | Olay dinleyicisi kaldırır |
| `removeAllListeners(event)` | event: String (opsiyonel) | this | Tüm olay dinleyicilerini kaldırır |

### Olaylar

| Olay | Veri | Açıklama |
|------|------|----------|
| `open` | - | WebSocket bağlantısı açıldığında |
| `close` | `{ code, reason }` | WebSocket bağlantısı kapandığında |
| `error` | `{ message }` | WebSocket hatası oluştuğunda |
| `auth_success` | - | Kimlik doğrulama başarılı olduğunda |
| `auth_failure` | String | Kimlik doğrulama başarısız olduğunda |
| `player_join` | `{ player }` | Oyuncu sunucuya katıldığında |
| `player_quit` | `{ player }` | Oyuncu sunucudan ayrıldığında |
| `command_executed` | `{ player, command }` | Komut çalıştırıldığında |

### WebSocket Mesaj Formatları

#### İstek Mesajları

**Komut Çalıştırma:**
```json
{
  "type": "command",
  "command": "çalıştırılacak-komut",
  "id": "mesaj-id"
}
```

**Placeholder Değeri Alma:**
```json
{
  "type": "placeholder",
  "placeholder": "placeholder-metni",
  "player": "oyuncu-adı", // Opsiyonel
  "id": "mesaj-id"
}
```

**Oyuncu Durumu Kontrolü:**
```json
{
  "type": "isPlayerOnline",
  "player": "oyuncu-adı",
  "id": "mesaj-id"
}
```

**Çevrimiçi Oyuncuları Alma:**
```json
{
  "type": "getOnlinePlayers",
  "id": "mesaj-id"
}
```

**Sunucu Bilgilerini Alma:**
```json
{
  "type": "getServerInfo",
  "id": "mesaj-id"
}
```

#### Yanıt Mesajları

**Komut Yanıtı:**
```json
{
  "type": "commandResponse",
  "status": "success|failure",
  "message": "sonuç-veya-hata-mesajı",
  "id": "mesaj-id"
}
```

**Placeholder Yanıtı:**
```json
{
  "type": "placeholderResponse",
  "value": "placeholder-değeri",
  "id": "mesaj-id"
}
```

**Oyuncu Durumu Yanıtı:**
```json
{
  "type": "playerOnlineResponse",
  "online": true|false,
  "id": "mesaj-id"
}
```

**Çevrimiçi Oyuncular Yanıtı:**
```json
{
  "type": "onlinePlayersResponse",
  "players": ["oyuncu1", "oyuncu2", ...],
  "id": "mesaj-id"
}
```

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

### Gelişmiş Güvenlik Örneği

```javascript
// Private key'i güvenli bir şekilde yükle ve kullan
const client = new CWebSenderClient({
    serverUrl: 'wss://mc.sunucu.com/websender', // SSL kullanımı
    privateKeyPath: './private.key',
    timeout: 30000
});

// Güvenli bir ortam doğrulama kontrolü
client.on('open', () => {
    // Sunucu SSL sertifikasını kontrol et
    const secureConnection = client.ws.url.startsWith('wss://');
    if (!secureConnection) {
        console.warn('UYARI: Güvenli olmayan bağlantı (SSL kullanılmıyor)');
    }
});

// Kimlik doğrulama izleme
client.on('auth_success', () => {
    console.log('Güvenli kimlik doğrulama başarılı, oturum başlatıldı');
    
    // Oturum başlangıç zamanını kaydet
    const sessionStart = new Date();
    
    // Her işlemde güvenlik kontrolü yap
    async function secureCommand(command) {
        // Zaman aşımı kontrolü
        const SESSION_MAX_TIME = 1000 * 60 * 60; // 1 saat
        const now = new Date();
        if (now - sessionStart > SESSION_MAX_TIME) {
            console.warn('Güvenlik: Oturum süresi doldu, yeniden bağlanılıyor...');
            await client.disconnect();
            await client.connect();
            return client.executeCommand(command);
        }
        
        // Komutları güvenlik açısından kontrol et
        if (command.includes('op ') || command.includes('deop ')) {
            console.warn('Güvenlik: Yüksek yetkili komut çalıştırılıyor!');
            // Burada ek doğrulama veya loglama yapılabilir
        }
        
        return client.executeCommand(command);
    }
    
    // Güvenli komut çalıştırma
    secureCommand('say Güvenli oturum başlatıldı')
        .then(response => console.log('Komut çalıştırıldı:', response))
        .catch(error => console.error('Hata:', error.message));
});
```

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
- Tarayıcı ortamında çalıştırırken `jsrsasign` gibi bir RSA imzalama kütüphanesinin yüklü olması gerekir.
- Tarayıcıda çalıştırırken Cross-Origin Resource Sharing (CORS) politikasını dikkate alın.
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

## Lisans

MIT 