package its.cactusdev.cWebSender.security;

import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.security.*;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.logging.Logger;

public class KeyManager {
    private final JavaPlugin plugin;
    private final Logger logger;
    private PrivateKey privateKey;
    private PublicKey publicKey;
    private final File keysDir;
    private final File privateKeyFile;
    private final File publicKeyFile;

    public KeyManager(JavaPlugin plugin) {
        this.plugin = plugin;
        this.logger = plugin.getLogger();
        this.keysDir = new File(plugin.getDataFolder(), "keys");
        this.privateKeyFile = new File(keysDir, "private.key");
        this.publicKeyFile = new File(keysDir, "public.key");
    }

    public void initialize() {
        if (!keysDir.exists() && !keysDir.mkdirs()) {
            logger.severe("Keys dizini oluşturulamadı!");
            return;
        }

        if (!privateKeyFile.exists() || !publicKeyFile.exists()) {
            logger.info("Anahtar çifti bulunamadı, yeni anahtar çifti oluşturuluyor...");
            generateKeyPair();
        } else {
            logger.info("Mevcut anahtar çifti yükleniyor...");
            loadKeys();
        }
    }

    private void generateKeyPair() {
        try {
            KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
            keyGen.initialize(2048);
            KeyPair pair = keyGen.generateKeyPair();
            
            this.privateKey = pair.getPrivate();
            this.publicKey = pair.getPublic();
            
            savePrivateKey();
            savePublicKey();
            
            logger.info("Yeni RSA anahtar çifti başarıyla oluşturuldu ve kaydedildi.");
        } catch (NoSuchAlgorithmException | IOException e) {
            logger.severe("Anahtar çifti oluşturulurken hata: " + e.getMessage());
        }
    }

    private void savePrivateKey() throws IOException {
        try (FileOutputStream fos = new FileOutputStream(privateKeyFile)) {
            fos.write(privateKey.getEncoded());
        }
    }

    private void savePublicKey() throws IOException {
        try (FileOutputStream fos = new FileOutputStream(publicKeyFile)) {
            fos.write(publicKey.getEncoded());
        }
    }

    private void loadKeys() {
        try {
            // Private key'i yükle
            byte[] privateKeyBytes = Files.readAllBytes(privateKeyFile.toPath());
            PKCS8EncodedKeySpec privateKeySpec = new PKCS8EncodedKeySpec(privateKeyBytes);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            this.privateKey = keyFactory.generatePrivate(privateKeySpec);

            // Public key'i yükle
            byte[] publicKeyBytes = Files.readAllBytes(publicKeyFile.toPath());
            X509EncodedKeySpec publicKeySpec = new X509EncodedKeySpec(publicKeyBytes);
            this.publicKey = keyFactory.generatePublic(publicKeySpec);
            
            logger.info("Anahtar çifti başarıyla yüklendi.");
        } catch (IOException | NoSuchAlgorithmException | InvalidKeySpecException e) {
            logger.severe("Anahtarlar yüklenirken hata: " + e.getMessage());
        }
    }

    public String getPublicKeyAsBase64() {
        if (publicKey == null) {
            return null;
        }
        return Base64.getEncoder().encodeToString(publicKey.getEncoded());
    }

    public boolean verifySignature(String data, String signature) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(publicKey);
            sig.update(data.getBytes());
            return sig.verify(Base64.getDecoder().decode(signature));
        } catch (NoSuchAlgorithmException | InvalidKeyException | SignatureException e) {
            logger.warning("İmza doğrulanırken hata: " + e.getMessage());
            return false;
        }
    }

    public String sign(String data) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initSign(privateKey);
            sig.update(data.getBytes());
            return Base64.getEncoder().encodeToString(sig.sign());
        } catch (NoSuchAlgorithmException | InvalidKeyException | SignatureException e) {
            logger.warning("İmzalama hatası: " + e.getMessage());
            return null;
        }
    }

    public PrivateKey getPrivateKey() {
        return privateKey;
    }

    public PublicKey getPublicKey() {
        return publicKey;
    }
} 