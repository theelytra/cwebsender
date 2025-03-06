package its.cactusdev.cWebSender;

import its.cactusdev.cWebSender.config.ConfigManager;
import its.cactusdev.cWebSender.security.AuthenticationService;
import its.cactusdev.cWebSender.security.KeyManager;
import its.cactusdev.cWebSender.websocket.WebSocketManager;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.ChatColor;

public class CWebSender extends JavaPlugin {
    private WebSocketManager webSocketManager;
    private KeyManager keyManager;
    private AuthenticationService authService;
    private ConfigManager configManager;

    @Override
    public void onEnable() {
        getLogger().info("cWebSender eklentisi başlatılıyor...");
        
        // Yapılandırma yöneticisini başlat
        configManager = new ConfigManager(this);
        
        // Anahtar yöneticisini başlat
        keyManager = new KeyManager(this);
        keyManager.initialize();
        
        // Kimlik doğrulama servisini başlat
        authService = new AuthenticationService(this, keyManager, configManager.isDebugMode());
        
        // WebSocket yöneticisini başlat
        webSocketManager = new WebSocketManager(this, authService, configManager.getPort(), configManager.isDebugMode());
        webSocketManager.start();
        
        // Komutları kaydet
        getCommand("cwebsender").setExecutor(this);
        
        getLogger().info("WebSocket portu: " + configManager.getPort());
        getLogger().info("cWebSender eklentisi başarıyla etkinleştirildi!");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("cwebsender")) {
            if (args.length == 0) {
                sender.sendMessage(ChatColor.GREEN + "cWebSender " + getDescription().getVersion());
                sender.sendMessage(ChatColor.YELLOW + "/cwebsender reload " + ChatColor.WHITE + "- Yapılandırmayı yeniden yükler");
                sender.sendMessage(ChatColor.YELLOW + "/cwebsender status " + ChatColor.WHITE + "- WebSocket sunucu durumunu gösterir");
                return true;
            }

            if (args[0].equalsIgnoreCase("reload")) {
                if (!sender.hasPermission("cwebsender.reload")) {
                    sender.sendMessage(ChatColor.RED + "Bu komutu kullanmak için yetkiniz yok!");
                    return true;
                }
                
                // Yapılandırma dosyasını yeniden yükle
                reloadConfig();
                configManager = new ConfigManager(this);
                
                // WebSocket sunucusunu yeniden başlat
                webSocketManager.stop();
                webSocketManager = new WebSocketManager(this, authService, configManager.getPort(), configManager.isDebugMode());
                webSocketManager.start();
                
                sender.sendMessage(ChatColor.GREEN + "cWebSender yapılandırması yeniden yüklendi!");
                return true;
            }

            if (args[0].equalsIgnoreCase("status")) {
                if (!sender.hasPermission("cwebsender.status")) {
                    sender.sendMessage(ChatColor.RED + "Bu komutu kullanmak için yetkiniz yok!");
                    return true;
                }
                
                boolean isRunning = webSocketManager != null;
                sender.sendMessage(ChatColor.GREEN + "WebSocket Sunucu Durumu: " + 
                    (isRunning ? ChatColor.GREEN + "Çalışıyor" : ChatColor.RED + "Çalışmıyor"));
                sender.sendMessage(ChatColor.GREEN + "Port: " + ChatColor.WHITE + configManager.getPort());
                sender.sendMessage(ChatColor.GREEN + "Debug Modu: " + ChatColor.WHITE + 
                    (configManager.isDebugMode() ? "Açık" : "Kapalı"));
                return true;
            }
            
            sender.sendMessage(ChatColor.RED + "Geçersiz komut! Kullanım: /cwebsender [reload|status]");
            return true;
        }
        return false;
    }

    @Override
    public void onDisable() {
        if (webSocketManager != null) {
            webSocketManager.stop();
        }
        getLogger().info("cWebSender eklentisi devre dışı bırakıldı!");
    }
    
    public ConfigManager getConfigManager() {
        return configManager;
    }
}