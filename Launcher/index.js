const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { Client } = require("minecraft-launcher-core");
const launcher = new Client();
const fs = require("fs-extra");

const { Auth, Minecraft, tokenUtils } = require("msmc");
const { log } = require("console");
const authManager = new Auth("select_account");

// Variables globales
let appDataPath = app.getPath("appData");
let mainWindow;
let token;

// Création de la fenêtre principale
function createWindow() {
  mainWindow = new BrowserWindow({
    // Icone du launcher
    icon: path.join(__dirname, "Asset/images/logo.png"),
    width: 1000,
    height: 750,
    autoHideMenuBar: true,
    webPreferences: {
      // Requis pour l'utilisation des modules coté renderer
      nodeIntegration: true,
      contextIsolation: false,
      /* Requis en cas d'utilisation de titlebar custom
      enableRemoteModule: true,*/
    },
  });

  mainWindow.loadURL(path.join(__dirname, "index.html"));
}

// Quand l'application est chargée, afficher la fenêtre
app.whenReady().then(() => {
  createWindow();
  const tokenPath = path.join(__dirname, "token.json");
  if (fs.existsSync(tokenPath)) {
      const tokenData = JSON.parse(fs.readFileSync(tokenPath));
      autoLogin(tokenData);
  }
});

// Si toutes les fenêtres sont fermées, quitter l'application
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// AUTO LOGIN
function autoLogin(tokenData) {
  mainWindow.webContents.send("connexion");
  const refreshToken = tokenData.parent.msToken.refresh_token;
  token = tokenUtils.fromToken(Auth, tokenData);

  authManager.refresh(refreshToken)
    .then(async (user) => {
      // Charger l'interface utilisateur principale avec l'utilisateur connecté
      mainWindow.loadURL(path.join(__dirname, "app.html")).then(() => {
        mainWindow.webContents.send("user", tokenData.profile.name);
      });
    })
    .catch((error) => {
      // Gérer les tokens expirés ou les erreurs d'authentification
      console.error("Auto login error:", error);
      mainWindow.loadURL(path.join(__dirname, "index.html"));
      mainWindow.webContents.send("err", "Tokens expirés ou erreur d'authentification");
    });
}

// LOGIN
ipcMain.on("login", async (evt, save) => {
  const tokenPath = path.join(__dirname, "token.json");
  try {

    if (fs.existsSync(tokenPath)) {
      const tokenData = JSON.parse(fs.readFileSync(tokenPath));
      autoLogin(tokenData);
      return;
    }

    const windowWidth = 600;
    const windowHeight = 600;
    const { screen } = require("electron");
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.floor((width - windowWidth) / 2);
    const y = Math.floor((height - windowHeight) / 2);

    // Lancer la fenêtre de connexion en utilisant les propriétés spécifiées
    const xboxManager = await authManager.launch("electron", {
        width: windowWidth,
        height: windowHeight,
        x: x,
        y: y,
    });
    token = await xboxManager.getMinecraft();
    const username = token.profile.name;

    if(save)
    {
      // Enregistrez le token dans un fichier
      fs.writeFileSync(tokenPath, JSON.stringify(token));
    }

    mainWindow.loadURL(path.join(__dirname, "app.html")).then(() => {
      mainWindow.webContents.send("user", username);
    });
  } catch (error) {
    console.error("Authentication error:", error);
    evt.sender.send("err", "Authentication error: " + error.message);
  }
});

//CHECK JAVA
function findJavaPath() {
  const possibleJavaPaths = [
      'C:\\Program Files\\Java',
      'C:\\Program Files (x86)\\Java',
      'C:\\ProgramData\\Oracle\\Java',
      // Ajoutez d'autres emplacements si nécessaire
  ];

  for (const javaPath of possibleJavaPaths) {
      if (fs.existsSync(javaPath)) {
          const javaVersions = fs.readdirSync(javaPath);
          for (const version of javaVersions) {
              if (version.startsWith('jdk') || version.startsWith('jre')) {
                  const javaExecutablePath = path.join(javaPath, version, 'bin', 'java.exe');
                  if (fs.existsSync(javaExecutablePath)) {
                      return javaExecutablePath;
                  }
              }
          }
      }
  }
  mainWindow.webContents.send("errLaunch", "Java erreur : java n'est pas trouver");
  return null;
}

const modsLink = "https://www.dropbox.com/scl/fi/paim8kzc60o5hy8vjjx4i/mods.zip?rlkey=sn08av83883ewhtbc6uh8xf2p&dl=1";

//PLAY
ipcMain.on("play", async (evt, selectedRAM) => {
  try {
      let modsPath = path.join(appDataPath, ".rynvarn", "mods");
      let isModpackInstalled = fs.existsSync(modsPath);

      const launchOptions = {
        clientPackage: isModpackInstalled ? null : modsLink,
        removePackage: true,
        authorization: token.mclc(),
        root: path.join(appDataPath, ".rynvarn"),
        version: {
          number: "1.12.2",
          type: "release",
        },
        forge: path.join(appDataPath, ".rynvarn", "minecraft.jar"),
        javaPath: findJavaPath(),
        memory: {
          max: `${selectedRAM}G`,
          min: '4G',
        },
      };
      console.log("Options de la JVM :", launchOptions.javaOptions);

      ipcMain.on('updateMemory', (event, selectedRAM) => {
        launchOptions.memory = {
          max: `${selectedRAM}G`,
          min: '4G', // Garder la mémoire minimale à 4G
        };
      });

    //PROGRESS BAR
    const animationDuration = 1000;
    const steps = 100;
    const increment = 100 / steps;
    mainWindow.webContents.send("updateProgress", 0);
        
    // Démarrer l'animation de la barre de progression
    let currentPercent = 0;
    for (let i = 0; i <= steps; i++) {
      setTimeout(() => {
        currentPercent += increment;
        mainWindow.webContents.send("updateProgress", currentPercent);
      }, (i + 1) * (animationDuration / steps));
    }
  
    const minecraftProcess = await launcher.launch(launchOptions);
    launcher.on('debug', (e) => console.log(e));
    launcher.on('data', (e) => console.log(e));

    minecraftProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Minecraft s'est fermé avec le code de sortie ${code}`);
        mainWindow.webContents.send('minecraftError', code);
      } else {
        console.log(`Minecraft a été fermé avec le code de sortie ${code}`);
      }
      mainWindow.webContents.send('closeMinecraft');
    });

    } catch (error) {
      console.error("Erreur lors du lancement de Minecraft :", error);
      evt.sender.send("errLaunch", "Launch error: " + error.message);
    }
});

//CLEAR TOKEN
ipcMain.on("logout", (evt,user)=> {
    mainWindow.loadURL(path.join(__dirname, "index.html")).then(() =>{
      const tokenPath = path.join(__dirname, "token.json");
      try {
        fs.unlinkSync(tokenPath);
        console.log("Token file deleted successfully.");
      } catch (err) {
        console.error("Error deleting token file:", err);
      }
    });
});