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

app.post("/upload-cv2", upload.fields([{ name: 'cvFile', maxCount: 1 }, { name: 'missionFile', maxCount: 1 }]), async (req, res) => {
  let cvFilePath, missionFilePath, missionText = '';
  try {
    if (!req.files['cvFile']) {
      return res.status(400).send("Aucun fichier CV téléchargé.");
    }

    cvFilePath = req.files['cvFile'][0].path;
    console.log("Chemin du fichier CV temporaire :", cvFilePath);

    const cvFileBuffer = await fs.readFile(cvFilePath);
    const cvPdfData = await pdfParse(cvFileBuffer);
    const cvExtractedText = cvPdfData.text;

    if (!cvExtractedText) {
      return res.status(400).send("Le fichier PDF du CV est vide ou illisible.");
    }

    if (req.files['missionFile']) {
      missionFilePath = req.files['missionFile'][0].path;
      console.log("Chemin du fichier de mission temporaire :", missionFilePath);

      const missionFileBuffer = await fs.readFile(missionFilePath);
      const missionPdfData = await pdfParse(missionFileBuffer);
      missionText = missionPdfData.text;

      if (!missionText) {
        return res.status(400).send("Le fichier PDF de mission est vide ou illisible.");
      }
    }

    const jobPosition = req.body.jobPosition || "Non spécifié";
    const combinedJobPosition = missionText ? `${jobPosition}\n\nMission:\n${missionText}` : jobPosition;

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
          content: `Voici le contenu du CV :\n${cvExtractedText}\n\nPoste recherché : ${combinedJobPosition}.
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
          content: `Vous êtes un assistant juridique spécialisé dans les délits et infractions référencés dans le code pénal ou d'autres textes juridiques pertinents.
Votre rôle est de répondre uniquement aux questions liées aux infractions ou délits juridiques, en guidant l'utilisateur vers les livres, chapitres et sections appropriés du code pénal ou des références juridiques suivante : ${legalData}

Vous devez suivre ces étapes dans votre réponse pour assurer clarté et précision :

Résumé court de la question posée.
Explication détaillée : Analysez et reformulez la question pour mieux orienter l'utilisateur.
Références pertinentes : Identifiez et citez précisément les livres, chapitres et sections appropriés des données juridiques fournies pour guider l'utilisateur.
Conclusion : Orientez l'utilisateur vers les références identifiées afin qu'il puisse approfondir sa recherche.
Les réponses doivent être structurées exactement comme suit, en respectant les placements des ** et # :

**Explication**
[Analysez et reformulez la question pour clarifier les enjeux et donner un aperçu de l'angle juridique pertinent.]

**Références juridiques**
[Identifiez les parties pertinentes des données fournies :

#Livre X, Chapitre Y, Section Z#
Listez chaque référence clairement pour guider l'utilisateur.]
**Conclusion**
[Concluez en réaffirmant les références identifiées et en guidant l'utilisateur vers les livres, chapitres et sections nécessaires pour trouver une réponse approfondie à sa question.]

Exemple de structure finale pour l'assistant

**Explication**
Comprendre les implications juridiques de cette infraction ainsi que les sections du code pénal qui y font référence.

**Références juridiques**
#Livre II, Chapitre IV, Section 3# : Relatif aux atteintes à la propriété.
#Livre III, Chapitre I# : Sur les peines applicables pour [préciser].
**Conclusion**
Pour approfondir la réponse à votre question, consultez les références suivantes dans le code pénal : #Livre II, Chapitre IV, Section 3# et #Livre III, Chapitre I#. Cela vous permettra d'avoir une compréhension complète des dispositions applicables.`,
        },
        { role: "user", content: question },
      ],
    });
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
