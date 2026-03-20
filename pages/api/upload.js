import axios from 'axios';
import FormData from 'form-data';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const CONFIG = {
  ORIGIN_URL: process.env.ORIGIN_URL || 'https://ximagine.io',
  UPLOAD_URL: process.env.UPLOAD_URL || 'https://upload.aiquickdraw.com/upload',
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || '',
  RSA_PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwJaZ7xi/H1H1jRg3DfYEEaqNYZZQHhzOZkdzzlkE510s/lP0vxZgHDVAI5dBevSpHtZHseWtKp93jqQwmdaaITGA+A2VpXDr2t8yJ0TZ3EjttLWWUT14Z+xAN04JUqks8/fm3Lpff9PYf8xGdh0zOO6XHu36N2zlK3KcpxoGBiYGYT0yJ4mH4gawXW18lddB+WuLFktzj9rPWaT2ofk1n+aULAr6lthpgFah47QI93bNwQ7cLuvwUUDmlfa4SUJlrdjfdWh7Vzh4amkmq+aR29FdZ0XLRo9FhMBQopGZCPFIucOjpYPIoWbSEQBR6VlM6OrZ4wHpLzAjVNnaGYdRLQIDAQAB
-----END PUBLIC KEY-----`
};

function generateIdentity() {
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  const ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  const major = Math.floor(Math.random() * (132 - 128 + 1) + 128);
  const build = Math.floor(Math.random() * (7000 - 6000 + 1) + 6000);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/537.36`;
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
  return { ip, ua, secChUa };
}

function getUploadHeaders(fileName) {
  // Simplified headers for Vercel (RSA encryption requires crypto library that may not be available)
  const ident = generateIdentity();
  return {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': CONFIG.ORIGIN_URL,
    'Referer': `${CONFIG.ORIGIN_URL}/`,
    'User-Agent': ident.ua,
    'uniqueid': uuidv4().replace(/-/g, ''),
    'X-Forwarded-For': ident.ip,
    'X-Real-IP': ident.ip,
    'sec-ch-ua': ident.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
  };
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Parse multipart form data
    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = buffer.toString().split(`--${boundary}`);
    
    let fileBuffer = null;
    let filename = '';
    let contentType = '';
    
    for (const part of parts) {
      if (part.includes('Content-Disposition: form-data; name="file"')) {
        const match = part.match(/filename="(.+?)"/);
        if (match) filename = match[1];
        
        const contentTypeMatch = part.match(/Content-Type: (.+?)\r\n/);
        if (contentTypeMatch) contentType = contentTypeMatch[1];
        
        const contentStart = part.indexOf('\r\n\r\n') + 4;
        const contentEnd = part.lastIndexOf('\r\n');
        const content = part.substring(contentStart, contentEnd);
        fileBuffer = Buffer.from(content, 'binary');
        break;
      }
    }
    
    if (!fileBuffer) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // Try imgbb first (simpler for Vercel)
    if (CONFIG.IMGBB_API_KEY) {
      try {
        const b64Image = fileBuffer.toString('base64');
        const formData = new FormData();
        formData.append('key', CONFIG.IMGBB_API_KEY);
        formData.append('image', b64Image);
        formData.append('name', filename);
        
        const response = await axios.post('https://api.imgbb.com/1/upload', formData, {
          headers: formData.getHeaders(),
          timeout: 60000
        });
        
        if (response.data.success && response.data.data && response.data.data.url) {
          return res.json({
            success: true,
            data: { url: response.data.data.url },
            code: 200
          });
        }
      } catch (imgbbErr) {
        console.error('ImgBB upload failed:', imgbbErr.message);
      }
    }
    
    return res.status(500).json({ 
      success: false, 
      error: 'Upload failed - no working upload method. Please set IMGBB_API_KEY in environment variables.'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
