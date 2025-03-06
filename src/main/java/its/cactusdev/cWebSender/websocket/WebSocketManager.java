package its.cactusdev.cWebSender.websocket;

import io.javalin.Javalin;
import io.javalin.websocket.WsContext;
import its.cactusdev.cWebSender.config.ConfigManager;
import its.cactusdev.cWebSender.handlers.CommandHandler;
import its.cactusdev.cWebSender.handlers.PlaceholderHandler;
import its.cactusdev.cWebSender.handlers.PlayerHandler;
import its.cactusdev.cWebSender.security.AuthenticationService;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

public class WebSocketManager {
    private final JavaPlugin plugin;
    private final Logger logger;
    private final boolean debugMode;
    private final int port;
    private Javalin app;
    private final Set<WsContext> authenticatedClients = ConcurrentHashMap.newKeySet();
    private final Map<WsContext, Long> pendingClients = new ConcurrentHashMap<>();
    private final AuthenticationService authService;
    private final CommandHandler commandHandler;
    private final PlaceholderHandler placeholderHandler;
    private final PlayerHandler playerHandler;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    private final long connectionTimeoutMs;
    private final ConfigManager configManager;

    public WebSocketManager(JavaPlugin plugin, AuthenticationService authService, int port, boolean debugMode) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.authService = authService;
        this.port = port;
        this.debugMode = debugMode;
        this.configManager = ((its.cactusdev.cWebSender.CWebSender)plugin).getConfigManager();
        this.connectionTimeoutMs = this.configManager.getConnectionTimeoutMs();
        this.commandHandler = new CommandHandler(plugin, debugMode);
        this.placeholderHandler = new PlaceholderHandler(plugin, debugMode);
        this.playerHandler = new PlayerHandler(plugin, debugMode);
    }

    public void start() {
        app = Javalin.create(config -> {
            config.showJavalinBanner = false;
        }).start(port);

        // Düzenli olarak kimlik doğrulaması yapılmamış eski bağlantıları temizle
        scheduler.scheduleWithFixedDelay(this::cleanupPendingConnections, 60, 60, TimeUnit.SECONDS);

        app.ws("/cwebsender", ws -> {
            ws.onConnect(ctx -> {
                if (debugMode) {
                    logger.info("Yeni bağlantı: " + ctx.sessionId());
                }
                // Bağlantıyı bekleyenlere ekle ve zaman damgasını kaydet
                pendingClients.put(ctx, System.currentTimeMillis());
                // Bağlantı kurulduğunda kimlik doğrulama challenge'ı gönder
                authService.sendAuthenticationChallenge(ctx);
            });

            ws.onClose(ctx -> {
                authenticatedClients.remove(ctx);
                pendingClients.remove(ctx);
                if (debugMode) {
                    logger.info("İstemci bağlantısı kesildi: " + ctx.sessionId());
                }
            });

            ws.onMessage(ctx -> {
                try {
                    String message = ctx.message();
                    JSONParser parser = new JSONParser();
                    JSONObject jsonMessage = (JSONObject) parser.parse(message);

                    String type = (String) jsonMessage.get("type");

                    if (type == null) {
                        sendErrorResponse(ctx, "Mesaj türü belirtilmedi");
                        return;
                    }

                    // Kimlik doğrulama yanıtı
                    if ("authResponse".equals(type)) {
                        handleAuthResponse(ctx, jsonMessage);
                        return;
                    }
                    
                    // Ping yanıtı - bağlantıyı aktif tutmak için
                    if ("ping".equals(type)) {
                        JSONObject response = new JSONObject();
                        response.put("type", "pong");
                        ctx.send(response.toJSONString());
                        return;
                    }

                    // Diğer tüm mesaj türleri için kimlik doğrulaması gerekli
                    if (!authenticatedClients.contains(ctx)) {
                        // Kimlik doğrulaması gerektiğini belirt ama bağlantıyı kapatma
                        sendErrorResponse(ctx, "Kimlik doğrulaması gerekli");
                        // Yeniden kimlik doğrulama challenge'ı gönder
                        authService.sendAuthenticationChallenge(ctx);
                        return;
                    }

                    if (debugMode) {
                        logger.info("Alınan mesaj türü: " + type);
                    }

                    // Mesaj türüne göre işleme
                    switch (type) {
                        case "command":
                            commandHandler.handleCommandRequest(ctx, jsonMessage);
                            break;
                        case "placeholder":
                            placeholderHandler.handlePlaceholderRequest(ctx, jsonMessage);
                            break;
                        case "isPlayerOnline":
                            playerHandler.handlePlayerOnlineRequest(ctx, jsonMessage);
                            break;
                        case "getOnlinePlayers":
                            playerHandler.handleGetOnlinePlayersRequest(ctx, (String) jsonMessage.get("id"));
                            break;
                        case "broadcast":
                            playerHandler.handleBroadcastRequest(ctx, jsonMessage);
                            break;
                        case "playerMessage":
                            playerHandler.handlePlayerMessageRequest(ctx, jsonMessage);
                            break;
                        default:
                            sendErrorResponse(ctx, "Bilinmeyen mesaj türü: " + type);
                    }
                } catch (ParseException e) {
                    sendErrorResponse(ctx, "Geçersiz JSON formatı");
                }
            });
        });
    }

    private void cleanupPendingConnections() {
        long currentTime = System.currentTimeMillis();
        // Kimlik doğrulaması yapılmamış ve zaman aşımına uğramış bağlantıları temizle
        pendingClients.entrySet().removeIf(entry -> {
            WsContext ctx = entry.getKey();
            long connectionTime = entry.getValue();
            
            // Kimlik doğrulaması yapılmışsa, pendingClients'tan çıkar
            if (authenticatedClients.contains(ctx)) {
                return true;
            }
            
            // Zaman aşımına uğramış bağlantıları kapat
            if (currentTime - connectionTime > connectionTimeoutMs) {
                if (debugMode) {
                    logger.warning("İstemci zaman aşımına uğradı, bağlantı kapatılıyor: " + ctx.sessionId());
                }
                // Zaman aşımı bildirimi gönder ve bağlantıyı kapat
                JSONObject response = new JSONObject();
                response.put("type", "error");
                response.put("message", "Kimlik doğrulama zaman aşımı");
                ctx.send(response.toJSONString());
                ctx.session.close(1001, "Kimlik doğrulama zaman aşımı");
                return true;
            }
            
            return false;
        });
    }
    
    private void handleAuthResponse(WsContext ctx, JSONObject jsonMessage) {
        String nonce = (String) jsonMessage.get("nonce");
        String signature = (String) jsonMessage.get("signature");

        if (authService.authenticate(ctx, nonce, signature)) {
            authenticatedClients.add(ctx);
            pendingClients.remove(ctx); // Başarılı kimlik doğrulama sonrası bekleyen listesinden çıkar
            
            JSONObject response = new JSONObject();
            response.put("type", "authResponse");
            response.put("status", "success");
            ctx.send(response.toJSONString());
            
            if (debugMode) {
                logger.info("İstemci kimlik doğrulaması başarılı: " + ctx.sessionId());
            }
        } else {
            JSONObject response = new JSONObject();
            response.put("type", "authResponse");
            response.put("status", "failed");
            response.put("message", "Kimlik doğrulama başarısız");
            ctx.send(response.toJSONString());
            
            if (debugMode) {
                logger.warning("İstemci kimlik doğrulaması başarısız: " + ctx.sessionId());
            }
            
            // Yeniden kimlik doğrulama challenge'ı gönder, bağlantıyı kapatma
            authService.sendAuthenticationChallenge(ctx);
        }
    }

    private void sendErrorResponse(WsContext ctx, String errorMessage) {
        JSONObject response = new JSONObject();
        response.put("type", "error");
        response.put("message", errorMessage);
        ctx.send(response.toJSONString());

        if (debugMode) {
            logger.warning("Hata yanıtı gönderildi: " + errorMessage);
        }
    }

    public void stop() {
        if (scheduler != null) {
            scheduler.shutdown();
        }
        if (app != null) {
            app.stop();
        }
    }
    
    // WebSocket sunucusunun çalışıp çalışmadığını kontrol et
    public boolean isRunning() {
        return app != null;
    }
} 