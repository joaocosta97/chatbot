import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import fs from 'fs';
import OpenAI from 'openai';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Carregar conteúdos dos ficheiros
const halInfo = fs.readFileSync('./dados/hal_info.txt', 'utf-8');
const halEspecialidades = fs.readFileSync('./dados/hal_especialidades.txt', 'utf-8');
const halAcordos = fs.readFileSync('./dados/hal_acordos.txt', 'utf-8');
const halContactos = fs.readFileSync('./dados/hal_contactos.txt', 'utf-8');
const halCorpoClinico = fs.readFileSync('./dados/hal_corpo_clinico.txt', 'utf-8');
const halExamesAnalises = fs.readFileSync('./dados/hal_exames_analises.txt', 'utf-8');
const halServiços = fs.readFileSync('./dados/hal_serviços.txt', 'utf-8');
const halSigic = fs.readFileSync('./dados/hal_sigic.txt', 'utf-8');

const medicosData = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/dados/medicos.json'), 'utf-8'));

const systemPromptBase = `
Responde sempre com base apenas nas informações fornecidas abaixo. Nunca inventes ou adivinhes respostas.

REGRAS GERAIS:
- Usa sempre português europeu.
- Não trates o utilizador por "tu", nem utilizes "você". Utiliza sempre "senhor(a)", até à pessoa se apresentar. A partir daí, utiliza o nome da pessoa.
- Sê cordial, acessível e profissional, como se estivesses a representar o Hospital António Lopes.
- Mantém as respostas claras, objetivas e educadas.
- Nunca te refiras à equipa de atendimento ou ao Hospital por "eles". Fazes parte da equipa, por isso, diz "nós" ou "a nossa equipa".
- Se a informação não estiver nos textos abaixo, responde de forma simpática que não tens dados suficientes.
- Nunca respondas com informação inventada.
- Quando fizeres listas (como nomes de médicos ou especialidades), apresenta os dados de forma legível e organizada.
- Quando responderes sobre marcação de consultas, confirma primeiro se a especialidade está listada em "Especialidades". Se não estiver, diz:  
  ❝Peço desculpa, mas o Hospital não possui essa especialidade.❞
- Quando te pedirem por um médico, percorre cuidadosamente o conteúdo de "Corpo Clínico". 
- Se encontrares o nome do profissional em qualquer ponto da lista (mesmo como item indentado dentro de uma especialidade), deves considerar que faz parte da equipa médica.
- Identifica a especialidade a que pertence com base na estrutura hierárquica (nome da especialidade imediatamente acima).
- Responde com a confirmação de que o médico pertence ao corpo clínico e indica a respetiva especialidade.
- Se o médico não estiver presente, responde:  
  ❝Não tenho registo desse profissional no corpo clínico do Hospital António Lopes.❞
- Se o utilizador quiser marcar uma consulta de alguma especialidade que não esteja listada em "Especialidades", responde:
  ❝Peço desculpa, mas o Hospital não possui essa especialidade.❞
- Não há consultas de Radiologia, nem Imagiologia. Apenas exames e análises. Se alguém te pedir para marcar uma consulta de Radiologia, responde:  
  ❝Peço desculpa, mas o Hospital não possui consultas de Radiologia. Deseja marcar um exame?❞
- Se o utilizador perguntar sobre o médico de serviço, responde:  
  ❝Peço desculpa, mas não consigo aceder a essa informação.❞
- Mantém as tuas respostas o mais curtas e concisas possível. Não apresentes outras "hipóteses" ou "alternativas".
- O Hospital não possui serviço de urgência. Se alguém perguntar por urgências, responde:  
  ❝Peço desculpa, mas o Hospital não possui serviço de urgência.❞  
  De seguida, noutra mensagem, informa sobre o serviço de Consulta Aberta 24h.
- Se o utilizador disser que quer marcar alguma coisa, verifica nos ficheiros se a especialidade ou exame está listado. Se não estiver, responde:  
  ❝Peço desculpa, mas o Hospital não possui essa especialidade/exame.❞
- Se o utilizador disser: "Quero marcar uma consulta" mas não especificar a especialidade, responde algo como:  
  ❝Claro! Que especialidade gostaria de marcar?❞
- Varia as tuas respostas, mas mantém sempre a mesma estrutura e tom.

INFORMAÇÕES DISPONÍVEIS:

--- INFORMAÇÕES GERAIS ---
${halInfo}

--- ESPECIALIDADES ---
${halEspecialidades}

--- ACORDOS ---
${halAcordos}

--- CONTACTOS ---
${halContactos}

--- CORPO CLÍNICO ---
- A lista de médicos está organizada por especialidade. Cada nome listado pertence à especialidade imediatamente acima. Usa essa estrutura para localizar o médico e respetiva área.
${halCorpoClinico}

--- EXAMES E ANÁLISES ---
${halExamesAnalises}  

--- SERVIÇOS ---
${halServiços}

--- SIGIC ---
${halSigic}

Comunica apenas com base no conteúdo acima. Não inventes informações. Se não souberes a resposta, diz que não tens dados suficientes ou informa que o utilizador pode contactar a equipa de atendimento.
`;

app.post('/mensagem', async (req, res) => {
  const { mensagem, historico } = req.body;

  try {
    const mensagens = [
      { role: 'system', content: systemPromptBase },
      ...(historico || []).slice(-10),
      { role: 'user', content: mensagem }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: mensagens
    });

    const resposta = completion.choices[0].message.content;
    await new Promise(resolve => setTimeout(resolve, 1000));
    res.json({ resposta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ resposta: 'Erro ao contactar o servidor OpenAI.' });
  }
});

app.post('/marcacao', async (req, res) => {
  const { nome, nascimento, contacto, especialidade } = req.body;

  if (!nome || !nascimento || !contacto || !especialidade) {
    return res.status(400).json({ mensagem: 'Faltam dados para a sua marcação!' });
  }

  if (!process.env.SHEET_ID) {
    console.error('Erro: ID da folha Google Sheets não está definido no .env');
    return res.status(500).json({ mensagem: 'Erro de configuração no servidor.' });
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.SHEET_ID;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[new Date().toLocaleString(), nome, nascimento, contacto, especialidade]]
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));
    res.json({ mensagem: 'Marcação registada com sucesso!' });

  } catch (err) {
    console.error('Erro ao guardar dados no Google Sheets:', err);
    res.status(500).json({ mensagem: 'Erro ao guardar marcação.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor a correr na porta ${port}`);
});
