package its.cactusdev.cWebSender.handlers;

import io.javalin.websocket.WsContext;
import me.clip.placeholderapi.PlaceholderAPI;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.util.logging.Logger;

public class PlaceholderHandler {
    private final JavaPlugin plugin;
    private final Logger logger;
    private final boolean debugMode;

    public PlaceholderHandler(JavaPlugin plugin, boolean debugMode) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.debugMode = debugMode;
    }

    public void handlePlaceholderRequest(WsContext ctx, JSONObject jsonMessage) {
        String placeholder = (String) jsonMessage.get("placeholder");
        String playerName = (String) jsonMessage.get("player");
        String id = (String) jsonMessage.get("id");

        if (placeholder == null) {
            sendErrorResponse(ctx, "Placeholder belirtilmedi", id);
            return;
        }

        if (playerName == null) {
            sendErrorResponse(ctx, "Oyuncu adı belirtilmedi", id);
            return;
        }

        // PlaceholderAPI'yi ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            String result = "";
            OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(playerName);

            // PlaceholderAPI eklentisinin yüklü olup olmadığını kontrol et
            if (Bukkit.getPluginManager().getPlugin("PlaceholderAPI") != null) {
                result = PlaceholderAPI.setPlaceholders(offlinePlayer, placeholder);
            } else {
                logger.warning("PlaceholderAPI bulunamadı! Raw placeholder döndürülüyor.");
                result = placeholder;
            }

            JSONObject response = new JSONObject();
            response.put("type", "placeholderResponse");
            response.put("placeholder", placeholder);
            response.put("result", result);
            response.put("player", playerName);
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Placeholder işlendi: " + placeholder + " -> " + result + " (Oyuncu: " + playerName + ")");
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