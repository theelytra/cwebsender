package its.cactusdev.cWebSender.websocket;

import io.javalin.Javalin;
import io.javalin.websocket.WsContext;
import its.cactusdev.cWebSender.handlers.CommandHandler;
import its.cactusdev.cWebSender.handlers.PlaceholderHandler;
import its.cactusdev.cWebSender.handlers.PlayerHandler;
import its.cactusdev.cWebSender.security.AuthenticationService;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

public class WebSocketManager {
    private final JavaPlugin plugin;
    private final Logger logger;
    private final boolean debugMode;
    private final int port;
    private Javalin app;
    private final Set<WsContext> authenticatedClients = ConcurrentHashMap.newKeySet();
    private final AuthenticationService authService;
    private final CommandHandler commandHandler;
    private final PlaceholderHandler placeholderHandler;
    private final PlayerHandler playerHandler;

    public WebSocketManager(JavaPlugin plugin, AuthenticationService authService, int port, boolean debugMode) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.authService = authService;
        this.port = port;
        this.debugMode = debugMode;
        this.commandHandler = new CommandHandler(plugin, debugMode);
        this.placeholderHandler = new PlaceholderHandler(plugin, debugMode);
        this.playerHandler = new PlayerHandler(plugin, debugMode);
    }

    public void start() {
        app = Javalin.create(config -> {
            config.showJavalinBanner = false;
        }).start(port);

        app.ws("/cwebsender", ws -> {
            ws.onConnect(ctx -> {
                if (debugMode) {
                    logger.info("Yeni bağlantı: " + ctx.sessionId());
                }
                // Bağlantı kurulduğunda kimlik doğrulama challenge'ı gönder
                authService.sendAuthenticationChallenge(ctx);
            });

            ws.onClose(ctx -> {
                authenticatedClients.remove(ctx);
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

                    // Diğer tüm mesaj türleri için kimlik doğrulaması gerekli
                    if (!authenticatedClients.contains(ctx)) {
                        sendErrorResponse(ctx, "Kimlik doğrulaması gerekli");
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

    private void handleAuthResponse(WsContext ctx, JSONObject jsonMessage) {
        String nonce = (String) jsonMessage.get("nonce");
        String signature = (String) jsonMessage.get("signature");

        if (authService.authenticate(ctx, nonce, signature)) {
            authenticatedClients.add(ctx);
            
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
        if (app != null) {
            app.stop();
        }
    }
} 