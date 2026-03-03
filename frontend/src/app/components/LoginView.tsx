import React, { useState } from 'react';
import { BookOpen, GraduationCap, ArrowLeft, Lock, User, Zap } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'teacher' | 'student';
type Track = 'institution' | 'individual';

interface AuthUser {
    name: string;
    email: string;
    role: Role;
    track: Track;
}

interface LoginViewProps {
    onLogin: (user: AuthUser, token: string) => void;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
    const [step, setStep] = useState<'role' | 'auth'>('role');
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [selectedRole, setSelectedRole] = useState<Role>('student');
    const [track, setTrack] = useState<Track>('institution');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const getPortalLabel = (role: Role, currentTrack: Track) => {
        if (role === 'teacher') return 'Teacher Portal';
        return currentTrack === 'individual' ? 'Individual Portal' : 'Student Portal';
    };

    const handleRoleSelect = (role: Role, selectedTrack: Track) => {
        setSelectedRole(role);
        setTrack(selectedTrack);
        setMode('login');
        setStep('auth');
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalizedUsername = username.trim();

        if (normalizedUsername.length < 3) {
            toast.error('Username must be at least 3 characters.');
            return;
        }

        if (password.length < 8) {
            toast.error('Password must be at least 8 characters.');
            return;
        }

        if (mode === 'signup') {
            if (name.trim().length < 2) {
                toast.error('Please enter your full name.');
                return;
            }
            if (name.trim().toLowerCase() !== normalizedUsername.toLowerCase()) {
                toast.error('Username must match your name.');
                return;
            }
            if (password !== confirmPassword) {
                toast.error('Passwords do not match.');
                return;
            }
        }

        setIsLoading(true);
        try {
            const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
            const payload = mode === 'signup'
                ? {
                    name: name.trim(),
                    username: normalizedUsername,
                    password,
                    role: selectedRole,
                    track
                }
                : {
                    username: normalizedUsername,
                    password
                };

            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || 'Authentication failed.');
            }

            if (mode === 'login') {
                const accountRole = data.user?.role as Role;
                const accountTrack = (data.user?.track || 'institution') as Track;
                const roleMismatch = accountRole !== selectedRole;
                const trackMismatch = accountRole === 'student' && accountTrack !== track;

                if (roleMismatch || trackMismatch) {
                    toast.error(`Wrong portal. Please use ${getPortalLabel(accountRole, accountTrack)} for this account.`);
                    return;
                }
            }

            toast.success(mode === 'signup' ? 'Signup successful!' : 'Login successful!');
            onLogin(data.user, data.token);
        } catch (error: any) {
            toast.error(error.message || 'Authentication failed.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                <div className="text-center mb-8">
                    <h1 className="text-5xl font-black tracking-tighter text-primary">C.O.T.E.ai</h1>
                    <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px] mt-1">
                        Concept Oriented Training and Exectution AI
                    </p>
                </div>

                <div className="bg-card border border-border/50 rounded-3xl p-8 shadow-xl">
                    {step === 'role' ? (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-2xl font-black">Choose your path</h2>
                                <p className="text-sm text-muted-foreground">Select role and learning mode.</p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handleRoleSelect('teacher', 'institution')}
                                    className="w-full flex items-center gap-4 p-4 bg-secondary/30 border rounded-2xl hover:border-green-500 transition-all text-left"
                                >
                                    <BookOpen size={22} className="text-green-500" />
                                    <div>
                                        <p className="font-black">Teacher</p>
                                        <p className="text-[10px] text-muted-foreground uppercase">Institution</p>
                                    </div>
                                </button>

                                <button
                                    onClick={() => handleRoleSelect('student', 'institution')}
                                    className="w-full flex items-center gap-4 p-4 bg-secondary/30 border rounded-2xl hover:border-blue-500 transition-all text-left"
                                >
                                    <GraduationCap size={22} className="text-blue-500" />
                                    <div>
                                        <p className="font-black">Student</p>
                                        <p className="text-[10px] text-muted-foreground uppercase">Institution</p>
                                    </div>
                                </button>

                                <button
                                    onClick={() => handleRoleSelect('student', 'individual')}
                                    className="w-full flex items-center gap-4 p-4 bg-secondary/30 border rounded-2xl hover:border-orange-500 transition-all text-left"
                                >
                                    <Zap size={22} className="text-orange-500" />
                                    <div>
                                        <p className="font-black">Individual Learner</p>
                                        <p className="text-[10px] text-muted-foreground uppercase">Personal</p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <header className="space-y-2">
                                <button
                                    onClick={() => setStep('role')}
                                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <ArrowLeft size={14} /> Back
                                </button>
                                <h2 className="text-2xl font-black">{mode === 'signup' ? 'Create Account' : 'Login'}</h2>
                                <p className="text-sm text-muted-foreground">
                                    Use your username and password to continue.
                                </p>
                            </header>

                            <div className="flex gap-2 bg-secondary/40 p-1 rounded-xl">
                                <button
                                    onClick={() => setMode('login')}
                                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'login' ? 'bg-background border border-border' : 'text-muted-foreground'}`}
                                >
                                    Login
                                </button>
                                <button
                                    onClick={() => setMode('signup')}
                                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'signup' ? 'bg-background border border-border' : 'text-muted-foreground'}`}
                                >
                                    Sign Up
                                </button>
                            </div>

                            <form onSubmit={handleAuth} className="space-y-4">
                                {mode === 'signup' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Name</label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                            <input
                                                required
                                                type="text"
                                                placeholder="Your full name"
                                                className="w-full pl-12 pr-4 py-3 bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                        <input
                                            required
                                            type="text"
                                            placeholder={mode === 'signup' ? "Must match your name" : "Enter your username"}
                                            className="w-full pl-12 pr-4 py-3 bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                        <input
                                            required
                                            type="password"
                                            placeholder="Minimum 8 characters"
                                            className="w-full pl-12 pr-4 py-3 bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {mode === 'signup' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Confirm Password</label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                            <input
                                                required
                                                type="password"
                                                placeholder="Repeat password"
                                                className="w-full pl-12 pr-4 py-3 bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-black text-lg disabled:opacity-50"
                                >
                                    {isLoading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Login'}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
