import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import WellnessWidget from './WellnessWidget.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WellnessWidget />
  </React.StrictMode>
);
