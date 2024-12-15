import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { Configuration, OpenAIApi } from "openai";
import cors from "cors";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });
let legalData = "";
const legalDataPath = path.resolve("./legalDb.txt");
const publicDir = path.resolve("./public");

// Vérifier si le dossier public existe, sinon le créer
const ensurePublicDir = async () => {
  try {
    await fs.access(publicDir);
  } catch (error) {
    console.log("Dossier public non trouvé. Création du dossier...");
    await fs.mkdir(publicDir, { recursive: true });
  }
};

ensurePublicDir();

// Charger les données juridiques
const loadLegalData = async () => {
  try {
    legalData = await fs.readFile(legalDataPath, "utf-8");
    console.log("Fichier texte chargé avec succès.");
  } catch (error) {
    console.error("Erreur lors du chargement du fichier texte :", error);
  }
};

loadLegalData();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.options("*", cors()); // Gère les requêtes preflight
app.use(express.json());

// Initialisation de l'API OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Endpoint 1 : Analyse de CV
app.post("/upload-cv", upload.single("cvFile"), async (req, res) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).send("Aucun fichier téléchargé.");
    }

    filePath = req.file.path;
    console.log("Chemin du fichier temporaire :", filePath);

    const fileBuffer = await fs.readFile(filePath);
    const pdfData = await pdfParse(fileBuffer);
    const extractedText = pdfData.text;

    if (!extractedText) {
      return res.status(400).send("Le fichier PDF est vide ou illisible.");
    }

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            `Vous êtes un assistant spécialisé en analyse de CV. 
            Chaque titre sera entouré d'une double astérisque comme ceci : **Titre**. Veuillez fournir une analyse structurée du CV suivant les critères donnés.`,
        },
        {
          role: "user",
          content: `Voici le contenu du CV :\n${extractedText}\n\nPoste recherché : ${req.body.jobPosition || "Non spécifié"}.
           Veuillez analyser selon les instructions suivantes :
           1. **Compétences Analysées** Listez les compétences mentionnées.
           2. **Résumé du profil** Fournissez un résumé du profil.
           3. **Adéquation au poste demandé** Indiquez si le candidat correspond au poste recherché.
           4. **Compétences manquantes** Si nécessaire, listez les compétences à acquérir pour correspondre au poste demandé.`,
        },
      ],
    });

    res.json({
      message: "Analyse réussie",
      analysis: completion.data.choices[0].message.content,
    });
  } catch (error) {
    console.error("Erreur lors de l'analyse du fichier :", error);
    res.status(500).send("Erreur lors de l'analyse du fichier.");
  } finally {
    if (filePath) {
      await fs.unlink(filePath);
    }
  }
});

// Endpoint 2 : Recherche avancée juridique (RAG)
app.post("/legal-query", async (req, res) => {
  const { question } = req.body;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "La question doit être une chaîne de caractères valide." });
  }

  if (!legalData) {
    return res.status(500).json({ error: "Les données juridiques ne sont pas disponibles." });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Vous êtes un assistant juridique. Si la question n'est pas lié a une question pénal ou juridique dis a l'utilisateur que tu répond seulement au question juridique et pénal
          Vous devez guider l'utilisateur en fournissant des références aux livres,
          chapitres et sections pertinents du code pénal en fonction des données suivantes :
          \n\n${legalData}\n\n Organisez votre réponse comme présentée :
          **Bref resume de la question** 
          explication de la question 
          #Référence au donnée fournis# (#livre1, section2, chapitre III#)
          **Conclusion**
          Répond à la question seulement en guidant l'utilisateur les livre pénal pour qu'il puisse trouver une réponse a sa question dans les livre et non grace a toi`,
        },
        { role: "user", content: question },
      ],
    });
    console.log(completion.data.choices[0].message)
    res.json({ answer: completion.data.choices[0].message.content, });
  } catch (error) {
    console.error("Erreur lors de l'appel à l'API OpenAI :", error);
    res.status(500).json({ error: "Erreur lors de la génération de la réponse." });
  }
});


// Endpoint 3 : Création de prompt

app.post("/test-query", async (req, res) => {
  const { question } = req.body;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "La question doit être une chaîne de caractères valide." });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Vous etes un générateur de prompt, génère le prompt les plus pertinent pour une IA LLM comme toi a partir du texte fournis`,
        },
        { role: "user", content: question },
      ],
    });

    res.json({ answer: completion.data.choices[0].message.content });
  } catch (error) {
    console.error("Erreur lors de l'appel à l'API OpenAI :", error);
    res.status(500).json({ error: "Erreur lors de la génération de la réponse." });
  }
});

// Serve static files
app.use(express.static(publicDir));


// Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
