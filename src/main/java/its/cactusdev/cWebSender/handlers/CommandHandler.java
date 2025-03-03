package its.cactusdev.cWebSender.handlers;

import io.javalin.websocket.WsContext;
import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.util.Arrays;
import java.util.List;
import java.util.logging.Logger;

public class CommandHandler {
    private final JavaPlugin plugin;
    private final Logger logger;
    private final boolean debugMode;
    private final List<String> blockedCommands = Arrays.asList("stop", "op", "deop", "reload");

    public CommandHandler(JavaPlugin plugin, boolean debugMode) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.debugMode = debugMode;
    }

    public void handleCommandRequest(WsContext ctx, JSONObject jsonMessage) {
        String command = (String) jsonMessage.get("command");
        String id = (String) jsonMessage.get("id");

        if (command == null) {
            sendErrorResponse(ctx, "Komut belirtilmedi", id);
            return;
        }
        
        for (String blocked : blockedCommands) {
            if (command.toLowerCase().startsWith(blocked)) {
                sendErrorResponse(ctx, "Bu komut çalıştırılamaz: " + command, id);
                return;
            }
        }
        
        // Komutu ana thread'de çalıştır
        Bukkit.getScheduler().runTask(plugin, () -> {
            boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);

            JSONObject response = new JSONObject();
            response.put("type", "commandResponse");
            response.put("success", success);
            if (id != null) {
                response.put("id", id);
            }

            ctx.send(response.toJSONString());

            if (debugMode) {
                logger.info("Komut çalıştırıldı: " + command + " (Başarılı: " + success + ")");
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