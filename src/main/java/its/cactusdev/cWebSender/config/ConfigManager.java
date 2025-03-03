package its.cactusdev.cWebSender.config;

import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Logger;

public class ConfigManager {
    private final JavaPlugin plugin;
    private final Logger logger;
    private int port;
    private boolean debugMode;

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

        if (debugMode) {
            logger.info("Debug modu etkin!");
        }
    }

    public int getPort() {
        return port;
    }

    public boolean isDebugMode() {
        return debugMode;
    }
} 