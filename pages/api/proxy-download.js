import axios from 'axios';
import https from 'https';

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  responseType: 'stream'
});

function generateIdentity() {
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  const ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  const major = Math.floor(Math.random() * (132 - 128 + 1) + 128);
  const build = Math.floor(Math.random() * (7000 - 6000 + 1) + 6000);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/537.36`;
  return { ua };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }
  
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Missing URL');
  }
  
  try {
    const ident = generateIdentity();
    const response = await axiosInstance.get(url, {
      headers: {
        'User-Agent': ident.ua,
        'Referer': 'https://ximagine.io',
        'Accept': '*/*'
      },
      timeout: 60000
    });
    
    const filename = url.split('/').pop().split('?')[0] || 'video.mp4';
    const finalFilename = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    
    response.data.pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send(error.message);
  }
}
