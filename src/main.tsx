import {BrowserRouter, Routes, Route, Navigate} from 'react-router-dom';
import React from 'react';
import ReactDOM  from 'react-dom/client';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Register from './pages/Register';
import ProtectedRoute from './routes/ProtectedRoute';
import './index.css';



ReactDOM.createRoot(document.getElementById('root')!).render(
<React.StrictMode>
<BrowserRouter>
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />
  <Route path="*" element={<Navigate to={"/login"}/>} />
  <Route path="/dashboard" element={
    <ProtectedRoute>
      <Dashboard/>
    </ProtectedRoute>
  }
  />
  <Route path='*' element={<Navigate to="/" replace />}/>
</Routes>
</BrowserRouter>
</React.StrictMode>
);
