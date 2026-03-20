import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://api.ximagine.io/aimodels/api/v1',
  ORIGIN_URL: process.env.ORIGIN_URL || 'https://ximagine.io'
};

function generateIdentity() {
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  const ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  const major = Math.floor(Math.random() * (132 - 128 + 1) + 128);
  const build = Math.floor(Math.random() * (7000 - 6000 + 1) + 6000);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/537.36`;
  return { ip, ua };
}

function getHeaders(uniqueId = null) {
  const ident = generateIdentity();
  const uid = uniqueId || uuidv4().replace(/-/g, '');
  return {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': CONFIG.ORIGIN_URL,
    'Referer': `${CONFIG.ORIGIN_URL}/`,
    'User-Agent': ident.ua,
    'uniqueid': uid,
    'X-Forwarded-For': ident.ip,
    'X-Real-IP': ident.ip
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const taskId = req.query.taskId;
  const uniqueId = req.query.uniqueId;
  const taskType = req.query.type || 'video';
  
  if (!taskId) {
    return res.status(400).json({ error: 'Missing taskId' });
  }
  
  try {
    const headers = getHeaders(uniqueId);
    const channel = taskType === 'image' ? 'GROK_TEXT_IMAGE' : 'GROK_IMAGINE';
    
    const response = await axios.get(
      `${CONFIG.API_BASE}/ai/${taskId}?channel=${channel}`,
      { 
        headers, 
        timeout: 10000,
        httpsAgent
      }
    );
    
    const pollData = response.data;
    const data = pollData.data || {};
    const result = { status: 'processing', progress: 0 };
    
    if (data.completeData) {
      try {
        const inner = JSON.parse(data.completeData);
        if (inner.data && inner.data.result_urls && inner.data.result_urls.length > 0) {
          result.status = 'completed';
          result.videoUrl = inner.data.result_urls[0];
          result.urls = inner.data.result_urls;
        } else {
          result.status = 'failed';
          result.error = 'No video returned';
        }
      } catch (e) {
        result.status = 'failed';
        result.error = `Parse error: ${e.message}`;
      }
    } else if (data.failMsg) {
      result.status = 'failed';
      result.error = data.failMsg;
    } else if (data.progress) {
      result.progress = parseInt(parseFloat(data.progress) * 100);
    }
    
    return res.json(result);
    
  } catch (error) {
    console.error('Status query error:', error);
    return res.status(500).json({ error: error.message });
  }
}
