import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const COLORS = ['blue', 'red', 'green', 'yellow', 'purple', 'orange'];

// Use environment variable for WebSocket URL, fallback to localhost for development
const getWebSocketUrl = () => {
  // Priority 1: Use environment variable if set
  if (process.env.REACT_APP_WS_URL) {
    return process.env.REACT_APP_WS_URL;
  }
  // Priority 2: Development - use localhost
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:3001';
  }
  // Priority 3: Production fallback - auto-detect protocol and use same host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname + (window.location.port ? ':' + window.location.port : '');
  return `${protocol}//${host}`;
};

const WS_URL = getWebSocketUrl();

// Get next color ensuring no consecutive repeats
const getNextColor = (currentColor) => {
  // Get last used color from localStorage
  const lastColor = localStorage.getItem('lastFeedbackColor');
  
  // Filter out the last color to avoid repeats
  const availableColors = COLORS.filter(color => color !== lastColor);
  
  // If somehow all colors are filtered out, use all colors
  const colorPool = availableColors.length > 0 ? availableColors : COLORS;
  
  // Select random color from available pool
  const nextColor = colorPool[Math.floor(Math.random() * colorPool.length)];
  
  // Save to localStorage for next session
  localStorage.setItem('lastFeedbackColor', nextColor);
  
  // Log for debugging
  console.log(`🎨 Color Rotation: ${lastColor || 'none'} → ${nextColor}`);
  
  return nextColor;
};

function App() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });
  const [stage, setStage] = useState('form'); // form, folding, floating, sent
  const [currentImage, setCurrentImage] = useState(0);
  const [currentColor, setCurrentColor] = useState(() => getNextColor());
  const [touchStart, setTouchStart] = useState(null);
  const [imagesPreloaded, setImagesPreloaded] = useState(false);
  const wsRef = useRef(null);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);
  const backgroundRef = useRef(null);
  const currentFrameRef = useRef(1);
  const imageCache = useRef([]);

  useEffect(() => {
    // Preload images for smooth animation with caching
    const preloadImages = () => {
      setImagesPreloaded(false);
      const imagePromises = [];
      const cachedImages = [];
      
      for (let i = 1; i <= 100; i++) {
        const img = new Image();
        img.src = `/images/${currentColor}/${i}.png`;
        
        // Keep reference to prevent garbage collection
        cachedImages.push(img);
        
        imagePromises.push(
          new Promise((resolve) => {
            img.onload = () => {
              // Force browser to decode image
              if (img.decode) {
                img.decode().then(resolve).catch(resolve);
              } else {
                resolve();
              }
            };
            img.onerror = resolve; // Still resolve on error to not block
          })
        );
      }
      
      Promise.all(imagePromises).then(() => {
        // Store in ref to prevent garbage collection during animation
        imageCache.current = cachedImages;
        
        // Small delay to ensure browser has fully processed images
        setTimeout(() => {
          setImagesPreloaded(true);
          console.log(`✅ All ${cachedImages.length} images preloaded and cached for ${currentColor}`);
        }, 100);
      });
    };
    
    preloadImages();
    
    // Cleanup cache when color changes
    return () => {
      imageCache.current = [];
    };
  }, [currentColor]);

  useEffect(() => {
    // Connect to WebSocket
    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log('Connected to WebSocket server');
      ws.send(JSON.stringify({
        type: 'register',
        clientType: 'tablet'
      }));
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };
    
    wsRef.current = ws;
    
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    if (stage === 'folding' && backgroundRef.current && imagesPreloaded) {
      const ANIMATION_DURATION = 5000; // 5 seconds total
      const TOTAL_FRAMES = 99; // 1 to 100
      
      startTimeRef.current = null;
      currentFrameRef.current = 1;
      
      // Force layout to ensure DOM is ready
      // eslint-disable-next-line no-unused-expressions
      void backgroundRef.current.offsetHeight;
      
      const animate = (timestamp) => {
        if (!startTimeRef.current) {
          startTimeRef.current = timestamp;
        }
        
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
        const frameNumber = Math.floor(progress * TOTAL_FRAMES) + 1;
        
        // Only update if frame changed (reduce unnecessary updates)
        if (frameNumber !== currentFrameRef.current && backgroundRef.current) {
          currentFrameRef.current = frameNumber;
          
          // Use will-change CSS hint for better performance
          if (frameNumber === 1) {
            backgroundRef.current.style.willChange = 'background-image';
          }
          
          // Direct DOM manipulation - no React re-render!
          backgroundRef.current.style.backgroundImage = 
            `url('/images/${currentColor}/${frameNumber}.png')`;
        }
        
        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          // Remove will-change to free resources
          if (backgroundRef.current) {
            backgroundRef.current.style.willChange = 'auto';
          }
          setCurrentImage(100); // Update React state at the end
          setStage('floating');
        }
      };
      
      animationRef.current = requestAnimationFrame(animate);
      
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        if (backgroundRef.current) {
          backgroundRef.current.style.willChange = 'auto';
        }
      };
    }
  }, [stage, currentColor, imagesPreloaded]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.name && formData.email && formData.message) {
      if (!imagesPreloaded) {
        console.log('Images still loading, please wait...');
        return;
      }
      setStage('folding');
      setCurrentImage(1);
    }
  };

  const handleTouchStart = (e) => {
    if (stage === 'floating') {
      setTouchStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (stage === 'floating' && touchStart !== null) {
      const touchEnd = e.touches[0].clientY;
      const diff = touchStart - touchEnd;
      
      // Swipe up detection (at least 100px)
      if (diff > 100) {
        handleSwipeUp();
      }
    }
  };

  const handleSwipeUp = () => {
    // Send feedback via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'new_feedback',
        feedback: {
          name: formData.name,
          email: formData.email,
          message: formData.message,
          color: currentColor
        }
      }));
    }
    
    setStage('sent');
    
    // Reset after animation
    setTimeout(() => {
      setFormData({ name: '', email: '', message: '' });
      setStage('form');
      setCurrentImage(0);
      setCurrentColor(getNextColor(currentColor));
      setTouchStart(null);
    }, 2000);
  };

  const getBackgroundImage = () => {
    if (stage === 'form') {
      return `url('/images/${currentColor}/1.png')`;
    } else if (stage === 'folding' || stage === 'floating' || stage === 'sent') {
      return `url('/images/${currentColor}/${currentImage}.png')`;
    }
    return 'none';
  };

  return (
    <div 
      className="app"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      <div 
        ref={backgroundRef}
        className={`background ${stage === 'floating' ? 'floating' : ''} ${stage === 'sent' ? 'swipe-up' : ''}`}
        style={{
          backgroundImage: getBackgroundImage()
        }}
      />
      
      {stage === 'form' && (
        <div className={`form-container ${stage === 'folding' ? 'fade-out' : ''}`}>
          <h1>Share Your Feedback</h1>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Enter your name"
              />
            </div>
            
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                placeholder="Enter your email"
              />
            </div>
            
            <div className="form-group">
              <label>Feedback</label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                required
                placeholder="Share your thoughts..."
                rows="6"
              />
            </div>
            
            <button type="submit" className="submit-btn" disabled={!imagesPreloaded}>
              {imagesPreloaded ? 'Send Feedback' : 'Loading Images...'}
            </button>
          </form>
        </div>
      )}
      
      {stage === 'floating' && (
        <div className="swipe-instruction">
          <p className="swipe-text">Swipe up</p>
        </div>
      )}
      
      {stage === 'sent' && (
        <div className="thank-you">
          <h2>Thank You!</h2>
          <p>Your feedback has been sent</p>
        </div>
      )}
    </div>
  );
}

export default App;

