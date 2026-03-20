import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [videoStyle, setVideoStyle] = useState('normal');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const fileInputRef = useRef(null);
  
  const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';
  
  const handleUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      if (data.success && data.data && data.data.url) {
        setUploadedImageUrl(data.data.url);
        setUploadedImage(URL.createObjectURL(file));
      } else {
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed: ' + error.message);
    }
  };
  
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) handleUpload(file);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleUpload(file);
  };
  
  const removeImage = () => {
    setUploadedImage(null);
    setUploadedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const generateVideo = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }
    
    setGenerating(true);
    
    const modelId = uploadedImageUrl ? 'grok-video-image' : `grok-video-${videoStyle}`;
    const taskId = `task_${Date.now()}`;
    const newTask = {
      id: taskId,
      prompt: prompt,
      model: modelId,
      ratio: aspectRatio,
      status: 'processing',
      progress: 0,
      createdAt: new Date().toISOString()
    };
    
    setTasks(prev => [newTask, ...prev]);
    
    try {
      const response = await fetch(`${API_BASE}/api/chat-completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{
            role: 'user',
            content: JSON.stringify({
              prompt: prompt,
              aspectRatio: aspectRatio,
              clientPollMode: true,
              imageUrls: uploadedImageUrl ? [uploadedImageUrl] : []
            })
          }],
          stream: true
        })
      });
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let realTaskId = null;
      let uniqueId = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const taskMatch = buffer.match(/TASK_ID:\s*([^\n\]]+)/);
        const uidMatch = buffer.match(/UID:\s*([^\n\]]+)/);
        
        if (taskMatch && !realTaskId) realTaskId = taskMatch[1].trim();
        if (uidMatch && !uniqueId) uniqueId = uidMatch[1].trim();
        
        if (realTaskId && uniqueId) break;
      }
      
      if (realTaskId) {
        pollTaskStatus(taskId, realTaskId, uniqueId);
      } else {
        throw new Error('Could not retrieve task ID');
      }
      
    } catch (error) {
      console.error('Generation error:', error);
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: 'failed', error: error.message } : t
      ));
      setGenerating(false);
    }
  };
  
  const pollTaskStatus = async (localTaskId, realTaskId, uniqueId) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/query-status?taskId=${realTaskId}&uniqueId=${uniqueId}&type=video`);
        const data = await response.json();
        
        if (data.status === 'completed') {
          clearInterval(pollInterval);
          setTasks(prev => prev.filter(t => t.id !== localTaskId));
          setHistory(prev => [{
            id: `hist_${Date.now()}`,
            prompt: prompt,
            url: data.videoUrl || (data.urls && data.urls[0]),
            model: `grok-video-${videoStyle}`,
            ratio: aspectRatio,
            createdAt: new Date().toISOString()
          }, ...prev]);
          setGenerating(false);
          alert('Video generation complete!');
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          setTasks(prev => prev.map(t => 
            t.id === localTaskId ? { ...t, status: 'failed', error: data.error } : t
          ));
          setGenerating(false);
          alert('Generation failed: ' + (data.error || 'Unknown error'));
        } else if (data.progress) {
          setTasks(prev => prev.map(t => 
            t.id === localTaskId ? { ...t, progress: data.progress } : t
          ));
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    }, 2000);
    
    // Timeout after 2 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      setTasks(prev => prev.map(t => 
        t.id === localTaskId ? { ...t, status: 'failed', error: 'Generation timed out' } : t
      ));
      setGenerating(false);
    }, 120000);
  };
  
  const downloadVideo = (url) => {
    const downloadUrl = `${API_BASE}/api/proxy-download?url=${encodeURIComponent(url)}`;
    window.open(downloadUrl, '_blank');
  };
  
  const deleteItem = (id, isHistory = false) => {
    if (isHistory) {
      setHistory(prev => prev.filter(item => item.id !== id));
    } else {
      setTasks(prev => prev.filter(task => task.id !== id));
    }
  };
  
  return (
    <>
      <Head>
        <title>Ximagine Pro - AI Video Generation</title>
        <meta name="description" content="Generate AI videos from text prompts" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      
      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: #fff;
        }
        
        .container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px;
        }
        
        .header {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .header h1 {
          font-size: 3rem;
          background: linear-gradient(135deg, #fff 0%, #a0c0ff 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .header p {
          color: rgba(255,255,255,0.8);
          margin-top: 10px;
        }
        
        .main-content {
          display: grid;
          grid-template-columns: 380px 1fr;
          gap: 24px;
        }
        
        .sidebar {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 24px;
          height: fit-content;
          position: sticky;
          top: 20px;
        }
        
        .control-group {
          margin-bottom: 24px;
        }
        
        .control-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          font-size: 0.9rem;
        }
        
        select, textarea {
          width: 100%;
          padding: 12px;
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 10px;
          color: #fff;
          font-size: 1rem;
          font-family: inherit;
        }
        
        select option {
          background: #333;
        }
        
        textarea {
          resize: vertical;
          min-height: 120px;
        }
        
        .upload-zone {
          border: 2px dashed rgba(255,255,255,0.3);
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .upload-zone:hover {
          border-color: rgba(255,255,255,0.6);
          background: rgba(255,255,255,0.05);
        }
        
        .preview-container {
          position: relative;
          margin-top: 12px;
        }
        
        .preview-image {
          max-width: 100%;
          max-height: 150px;
          border-radius: 10px;
        }
        
        .remove-image {
          position: absolute;
          top: -8px;
          right: -8px;
          background: #ff4757;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          cursor: pointer;
          color: white;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .generate-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
          margin-top: 20px;
        }
        
        .generate-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        
        .generate-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .gallery {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        
        .section-title {
          font-size: 1.5rem;
          margin-bottom: 16px;
        }
        
        .items-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }
        
        .item-card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          overflow: hidden;
          transition: transform 0.2s;
        }
        
        .item-card:hover {
          transform: translateY(-4px);
        }
        
        .media-container {
          width: 100%;
          aspect-ratio: 16/9;
          background: rgba(0,0,0,0.3);
          position: relative;
        }
        
        .media-container video, .media-container img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .task-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .progress-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 4px;
          background: rgba(255,255,255,0.2);
        }
        
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #667eea, #764ba2);
          transition: width 0.3s;
        }
        
        .item-info {
          padding: 16px;
        }
        
        .item-prompt {
          font-size: 0.9rem;
          margin-bottom: 12px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        .item-meta {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
          font-size: 0.8rem;
        }
        
        .meta-tag {
          background: rgba(255,255,255,0.2);
          padding: 4px 8px;
          border-radius: 6px;
        }
        
        .item-actions {
          display: flex;
          gap: 8px;
        }
        
        .action-btn {
          flex: 1;
          padding: 8px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: opacity 0.2s;
        }
        
        .action-btn:hover {
          opacity: 0.8;
        }
        
        .btn-download {
          background: #4caf50;
          color: white;
        }
        
        .btn-delete {
          background: #ff4757;
          color: white;
        }
        
        .empty-state {
          text-align: center;
          padding: 60px;
          background: rgba(255,255,255,0.05);
          border-radius: 16px;
          color: rgba(255,255,255,0.6);
        }
        
        @media (max-width: 768px) {
          .main-content {
            grid-template-columns: 1fr;
          }
          
          .sidebar {
            position: static;
          }
        }
      `}</style>
      
      <div className="container">
        <div className="header">
          <h1>🎬 Ximagine Pro</h1>
          <p>AI Video Generation Engine - Create stunning videos from text</p>
        </div>
        
        <div className="main-content">
          <div className="sidebar">
            <div className="control-group">
              <label>Aspect Ratio</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
              </select>
            </div>
            
            <div className="control-group">
              <label>Video Style</label>
              <select value={videoStyle} onChange={(e) => setVideoStyle(e.target.value)} disabled={uploadedImageUrl}>
                <option value="normal">Standard Realistic</option>
                <option value="fun">Fun Cartoon</option>
                <option value="spicy">Spicy Mode</option>
              </select>
            </div>
            
            <div className="control-group">
              <label>Reference Image (Optional)</label>
              <div className="upload-zone" onClick={() => fileInputRef.current?.click()} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
                {!uploadedImage ? (
                  <div>
                    <div>📸</div>
                    <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>Click or drag image here</div>
                  </div>
                ) : (
                  <div className="preview-container">
                    <img src={uploadedImage} alt="Preview" className="preview-image" />
                    <button className="remove-image" onClick={(e) => { e.stopPropagation(); removeImage(); }}>×</button>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />
              {uploadedImageUrl && <div style={{ fontSize: '0.75rem', marginTop: '8px', opacity: 0.7 }}>✓ Image uploaded</div>}
            </div>
            
            <div className="control-group">
              <label>Creative Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to generate..."
                maxLength="1800"
              />
              <div style={{ fontSize: '0.75rem', marginTop: '4px', textAlign: 'right', opacity: 0.7 }}>
                {prompt.length} / 1800
              </div>
            </div>
            
            <button className="generate-btn" onClick={generateVideo} disabled={generating || !prompt.trim()}>
              {generating ? 'Generating...' : '🎬 Generate Video'}
            </button>
          </div>
          
          <div className="gallery">
            {tasks.length > 0 && (
              <>
                <h2 className="section-title">🔄 Processing</h2>
                <div className="items-grid">
                  {tasks.map(task => (
                    <div key={task.id} className="item-card">
                      <div className="media-container">
                        {task.status === 'processing' ? (
                          <div className="task-overlay">
                            <div className="spinner"></div>
                            <div>{task.progress || 0}%</div>
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${task.progress || 0}%` }}></div>
                            </div>
                          </div>
                        ) : task.status === 'failed' ? (
                          <div className="task-overlay">
                            <div>❌ Failed</div>
                            <div style={{ fontSize: '0.8rem' }}>{task.error}</div>
                          </div>
                        ) : null}
                      </div>
                      <div className="item-info">
                        <div className="item-prompt">{task.prompt}</div>
                        <div className="item-meta">
                          <span className="meta-tag">{task.model?.replace('grok-', '')}</span>
                          <span className="meta-tag">{task.ratio}</span>
                        </div>
                        <div className="item-actions">
                          <button className="action-btn btn-delete" onClick={() => deleteItem(task.id, false)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {history.length > 0 && (
              <>
                <h2 className="section-title">📁 History</h2>
                <div className="items-grid">
                  {history.map(item => (
                    <div key={item.id} className="item-card">
                      <div className="media-container">
                        <video src={item.url} controls loop playsInline></video>
                      </div>
                      <div className="item-info">
                        <div className="item-prompt">{item.prompt}</div>
                        <div className="item-meta">
                          <span className="meta-tag">{item.model?.replace('grok-', '')}</span>
                          <span className="meta-tag">{item.ratio}</span>
                          <span className="meta-tag">{new Date(item.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="item-actions">
                          <button className="action-btn btn-download" onClick={() => downloadVideo(item.url)}>Download</button>
                          <button className="action-btn btn-delete" onClick={() => deleteItem(item.id, true)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {tasks.length === 0 && history.length === 0 && (
              <div className="empty-state">
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎬</div>
                <div>No videos generated yet</div>
                <div style={{ fontSize: '0.9rem', marginTop: '8px' }}>Enter a prompt and click Generate to get started</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
