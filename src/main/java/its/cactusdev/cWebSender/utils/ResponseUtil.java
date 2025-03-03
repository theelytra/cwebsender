package its.cactusdev.cWebSender.utils;

import io.javalin.websocket.WsContext;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.util.logging.Logger;

public class ResponseUtil {
    private final Logger logger;
    private final boolean debugMode;

    public ResponseUtil(JavaPlugin plugin, boolean debugMode) {
        this.logger = plugin.getLogger();
        this.debugMode = debugMode;
    }

    public void sendErrorResponse(WsContext ctx, String errorMessage, String id) {
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

    public void sendSuccessResponse(WsContext ctx, String type, JSONObject data, String id) {
        JSONObject response = new JSONObject();
        response.put("type", type);
        response.put("success", true);
        
        // Eğer veri varsa, yanıta ekle
        if (data != null) {
            for (Object key : data.keySet()) {
                response.put(key, data.get(key));
            }
        }
        
        if (id != null) {
            response.put("id", id);
        }
        
        ctx.send(response.toJSONString());
        
        if (debugMode) {
            logger.info(type + " yanıtı gönderildi");
        }
    }
} 