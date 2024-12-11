  import express from "express";
  import multer from "multer";
  import fs from "fs/promises";
  import path from "path";
  import pdfParse from "pdf-parse";
  import dotenv from "dotenv";
  import OpenAI from "openai";
  import cors from "cors";

  dotenv.config();

  const app = express();
  const upload = multer({ dest: "uploads/" });
  let legalData = "";
  const legalDataPath = path.resolve("./legalDb.txt");

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
      origin: "https://quentinrls.github.io", // Autorise GitHub Pages
      methods: ["GET", "POST", "OPTIONS"], // Autorise les méthodes HTTP nécessaires
      allowedHeaders: ["Content-Type"], // Autorise les en-têtes nécessaires
    })
  );
  

  app.use(express.static(path.resolve("public")));
  app.use(express.json());

  // Endpoint 1 : Analyse de CV
  app.post("/upload-cv", upload.single("cvFile"), async (req, res) => {
    let filePath;
    try {
      if (!req.file) {
        return res.status(400).send("Aucun fichier téléchargé.");
      }

      filePath = req.file.path;
      console.log("Chemin du fichier temporaire :", filePath);

      const fileBuffer = await fs.readFile("./" + filePath);
      const pdfData = await pdfParse(fileBuffer);
      const extractedText = pdfData.text;

      if (!extractedText) {
        return res.status(400).send("Le fichier PDF est vide ou illisible.");
      }

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY, // Lire la clé depuis les variables d'environnement
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "Vous êtes un assistant spécialisé en analyse de CV. Chaque titre sera entouré d'une double astérisque comme ceci : **Titre**",
          },
          {
            role: "user",
            content: `
              Voici le contenu du CV :
              ${extractedText}
          
              Poste recherché par l'employeur : ${req.body.jobPosition || "Non spécifié"}
          
              Veuillez analyser :
              1. Listez les compétences mentionnées. Et mettre en titre "Compétences Analysées"
              2. Fournissez un résumé du profil. Et mettre en titre "Résumé du profil"
              3. Indiquez si le candidat correspond au poste recherché. Et mettre en titre "Adéquation au poste demandé"
              4. Si nécessaire, indiquez quelles compétences supplémentaires sont nécessaires pour avoir un profil adéquat au poste recherché en faisant une liste. 
                Et mettre en titre "Compétences manquantes"
            `,
          },
        ],
      });

      const analysis = completion.choices[0]?.message?.content;

      res.json({
        message: "Analyse réussie",
        analysis,
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
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY, // Lire la clé depuis les variables d'environnement
      });
      const cleanQuestion = question.replace(/[\r\n]+/g, " ").trim();

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `les réponses n'ont pas pour objectif de répondre a la question mais de guider l'utilisateur dans les chapitres et sections du code pénal. 
            Vous êtes un assistant juridique. 
            Vos réponses serons organisé en plusieur titre, chaque titre doit etre entouré de deux astérix **Titre**.
            Il est donc néccéssaire de seulement présciser dans quel livre, chapitre et section il est possible de trouver la réponse a la question, 
            toujours préciser de quel livre et chapitre viens la sections mentionné. et affiché le nom des livres, chapitre et section entouré par le charactère # et jamais entre **
            exemple : **Différence entre meutre et homicide** #Livre II# #Chapitre 3# #section 1#
            il est important de faire une légère explication.
            utilise les information suivantes pour guider l'utilisateur :\n\n${legalData}\n\n`,
          },
          { role: "user", content: cleanQuestion },
        ],
      });

      const answer = completion.choices[0]?.message?.content.trim();
      res.json({ answer });
    } catch (error) {
      console.error("Erreur lors de l'appel à l'API OpenAI :", error);
      res.status(500).json({ error: "Erreur lors de la génération de la réponse." });
    }
  });

  const PORT = process.env.PORT || 3000; // Utilise le port assigné par Render ou 3000 par défaut pour le local
  app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT} et mercé`);
  });
  