package its.cactusdev.cWebSender.config;

import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Logger;

public class ConfigManager {
    private final JavaPlugin plugin;
    private final Logger logger;
    private int port;
    private boolean debugMode;
    private long connectionTimeoutSeconds;
    private long nonceExpirationSeconds;

    public ConfigManager(JavaPlugin plugin) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        loadConfig();
    }

    public void loadConfig() {
        plugin.saveDefaultConfig();
        FileConfiguration config = plugin.getConfig();

        // Yapılandırma dosyasından ayarları yükle
        port = config.getInt("websocket-port", 8080);
        debugMode = config.getBoolean("debug-mode", false);
        connectionTimeoutSeconds = config.getLong("websocket.connection-timeout-seconds", 300); // 5 dakika varsayılan
        nonceExpirationSeconds = config.getLong("websocket.nonce-expiration-seconds", 300); // 5 dakika varsayılan

        if (debugMode) {
            logger.info("Debug modu etkin!");
            logger.info("Bağlantı zaman aşımı: " + connectionTimeoutSeconds + " saniye");
            logger.info("Nonce süre aşımı: " + nonceExpirationSeconds + " saniye");
        }
    }
    
    public void reloadConfig() {
        plugin.reloadConfig();
        loadConfig();
        logger.info("Yapılandırma dosyası yeniden yüklendi.");
    }

    public int getPort() {
        return port;
    }

    public boolean isDebugMode() {
        return debugMode;
    }
    
    public long getConnectionTimeoutMs() {
        return connectionTimeoutSeconds * 1000;
    }
    
    public long getNonceExpirationMs() {
        return nonceExpirationSeconds * 1000;
    }
} 