package its.cactusdev.cWebSender.security;

import io.javalin.websocket.WsContext;
import its.cactusdev.cWebSender.CWebSender;
import its.cactusdev.cWebSender.config.ConfigManager;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

public class AuthenticationService {
    private final KeyManager keyManager;
    private final Logger logger;
    private final boolean debugMode;
    private final Map<String, String> nonceMap = new ConcurrentHashMap<>();
    private final Map<String, Long> nonceTimestamps = new ConcurrentHashMap<>();
    private final Map<String, String> sessionNonceMap = new ConcurrentHashMap<>(); // Session ID -> Nonce eşlemesi
    private final long nonceExpirationMs;

    public AuthenticationService(JavaPlugin plugin, KeyManager keyManager, boolean debugMode) {
        this.keyManager = keyManager;
        this.logger = plugin.getLogger();
        this.debugMode = debugMode;
        this.nonceExpirationMs = ((CWebSender)plugin).getConfigManager().getNonceExpirationMs();
    }

    public String generateNonce() {
        String nonce = UUID.randomUUID().toString();
        nonceMap.put(nonce, nonce);
        nonceTimestamps.put(nonce, Instant.now().toEpochMilli());
        
        // Süresi dolmuş nonce'ları temizle
        cleanExpiredNonces();
        
        return nonce;
    }

    private void cleanExpiredNonces() {
        long currentTime = Instant.now().toEpochMilli();
        nonceTimestamps.entrySet().removeIf(entry -> 
            currentTime - entry.getValue() > nonceExpirationMs);
        
        // Süresi dolmuş nonce'ları nonceMap'ten de kaldır
        nonceMap.keySet().retainAll(nonceTimestamps.keySet());
    }

    public boolean verifyNonce(String nonce) {
        if (nonce == null || !nonceMap.containsKey(nonce)) {
            return false;
        }
        
        Long timestamp = nonceTimestamps.get(nonce);
        if (timestamp == null) {
            return false;
        }
        
        long currentTime = Instant.now().toEpochMilli();
        if (currentTime - timestamp > nonceExpirationMs) {
            // Süresi dolmuş nonce
            nonceMap.remove(nonce);
            nonceTimestamps.remove(nonce);
            return false;
        }
        
        // Nonce kullanıldı, artık geçersiz
        nonceMap.remove(nonce);
        nonceTimestamps.remove(nonce);
        return true;
    }

    public boolean authenticate(WsContext ctx, String nonce, String signature) {
        if (nonce == null || signature == null) {
            if (debugMode) {
                logger.warning("Kimlik doğrulama başarısız: Nonce veya imza eksik");
            }
            return false;
        }

        if (!verifyNonce(nonce)) {
            if (debugMode) {
                logger.warning("Kimlik doğrulama başarısız: Geçersiz veya süresi dolmuş nonce");
            }
            
            // Oturum için kayıtlı bir nonce varsa ve bu eşleşmiyorsa yeni challenge gönderilecek
            if (sessionNonceMap.containsKey(ctx.sessionId()) && 
                !nonce.equals(sessionNonceMap.get(ctx.sessionId()))) {
                return false;
            }
            
            return false;
        }

        boolean verified = keyManager.verifySignature(nonce, signature);
        
        if (debugMode) {
            if (verified) {
                logger.info("Kimlik doğrulama başarılı: " + ctx.sessionId());
            } else {
                logger.warning("Kimlik doğrulama başarısız: İmza doğrulanamadı - " + ctx.sessionId());
            }
        }
        
        return verified;
    }

    public void sendAuthenticationChallenge(WsContext ctx) {
        String nonce = generateNonce();
        // Session ID ile nonce eşlemesini kaydet
        sessionNonceMap.put(ctx.sessionId(), nonce);
        
        JSONObject challenge = new JSONObject();
        challenge.put("type", "authChallenge");
        challenge.put("nonce", nonce);
        challenge.put("publicKey", keyManager.getPublicKeyAsBase64());
        
        ctx.send(challenge.toJSONString());
        
        if (debugMode) {
            logger.info("Kimlik doğrulama challenge gönderildi: " + ctx.sessionId());
        }
    }
} 