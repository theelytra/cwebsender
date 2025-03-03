package its.cactusdev.cWebSender.handlers;

import io.javalin.websocket.WsContext;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

public class PlayerHandler {
    private final JavaPlugin plugin;
    private final Logger logger;
    private final boolean debugMode;

    public PlayerHandler(JavaPlugin plugin, boolean debugMode) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.debugMode = debugMode;
    }

    public void handlePlayerOnlineRequest(WsContext ctx, JSONObject jsonMessage) {
        String playerName = (String) jsonMessage.get("player");
        String id = (String) jsonMessage.get("id");

        if (playerName == null) {
            sendErrorResponse(ctx, "Oyuncu adı belirtilmedi", id);
            return;
        }

        // Ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            boolean isOnline = Bukkit.getPlayer(playerName) != null;

            JSONObject response = new JSONObject();
            response.put("type", "playerOnlineResponse");
            response.put("player", playerName);
            response.put("online", isOnline);
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Oyuncu durumu kontrolü: " + playerName + " (Çevrimiçi: " + isOnline + ")");
            }
        });
    }

    public void handleGetOnlinePlayersRequest(WsContext ctx, String id) {
        // Ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            JSONObject response = new JSONObject();
            response.put("type", "onlinePlayersResponse");

            List<String> playerNames = new ArrayList<>();
            for (Player player : Bukkit.getOnlinePlayers()) {
                playerNames.add(player.getName());
            }

            response.put("players", playerNames);
            response.put("count", playerNames.size());
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Çevrimiçi oyuncular istendi. Toplam: " + playerNames.size());
            }
        });
    }

    public void handleBroadcastRequest(WsContext ctx, JSONObject jsonMessage) {
        String message = (String) jsonMessage.get("message");
        String id = (String) jsonMessage.get("id");

        if (message == null) {
            sendErrorResponse(ctx, "Mesaj belirtilmedi", id);
            return;
        }

        // Ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            Bukkit.broadcastMessage(message);

            JSONObject response = new JSONObject();
            response.put("type", "broadcastResponse");
            response.put("success", true);
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Yayın mesajı gönderildi: " + message);
            }
        });
    }

    public void handlePlayerMessageRequest(WsContext ctx, JSONObject jsonMessage) {
        String message = (String) jsonMessage.get("message");
        String playerName = (String) jsonMessage.get("player");
        String id = (String) jsonMessage.get("id");

        if (message == null) {
            sendErrorResponse(ctx, "Mesaj belirtilmedi", id);
            return;
        }

        if (playerName == null) {
            sendErrorResponse(ctx, "Oyuncu adı belirtilmedi", id);
            return;
        }

        // Ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player player = Bukkit.getPlayer(playerName);
            boolean success = false;

            if (player != null) {
                player.sendMessage(message);
                success = true;
            }

            JSONObject response = new JSONObject();
            response.put("type", "playerMessageResponse");
            response.put("success", success);
            response.put("player", playerName);
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Oyuncu mesajı gönderildi: " + message + " -> " + playerName + " (Başarılı: " + success + ")");
            }
        });
    }

    private void sendErrorResponse(WsContext ctx, String errorMessage, String id) {
        JSONObject response = new JSONObject();
        response.put("type", "error");
        response.put("message", errorMessage);
        if (id != null) {
            response.put("id", id);
        }
        ctx.send(response.toJSONString());

        if (debugMode) {
            logger.warning("Hata yanıtı gönderildi: " + errorMessage);
        }
    }
} 