import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { Dashboard } from './pages/Dashboard';
import { Exercises } from './pages/Exercises';
import { LogWorkout } from './pages/LogWorkout';
import { WorkoutDetail } from './pages/WorkoutDetail';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/log" element={<LogWorkout />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </BrowserRouter>
  );
}
