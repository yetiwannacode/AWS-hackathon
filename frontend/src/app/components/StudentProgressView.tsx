import React, { useState } from 'react';
import {
    Users,
    ArrowLeft,
    GraduationCap,
    TrendingUp,
    AlertCircle,
    PlayCircle,
    ArrowRight,
    Clock,
    ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { Topic } from '../App';
import { ActivityGraph } from './ActivityGraph';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { TeacherAnalyticsDashboard } from './TeacherAnalyticsDashboard';

interface StudentProgressViewProps {
    onCreateClass: (name: string, batch?: string, grade?: string) => Promise<string>;
    topics: Topic[];
    userRole: 'teacher' | 'student';
}

export const StudentProgressView: React.FC<StudentProgressViewProps> = ({ onCreateClass, topics, userRole }) => {
    const { weeklyLogs } = useActivityTracker();
    const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
    const [isCreatingClass, setIsCreatingClass] = useState(false);
    const [createdCode, setCreatedCode] = useState<string | null>(null);
    const [mistakes, setMistakes] = useState<any[]>([]);
    const [loadingMistakes, setLoadingMistakes] = useState(false);
    const [formData, setFormData] = useState({
        subjectName: '',
        batchYear: '',
        grade: ''
    });

    // Fetch real mistakes from backend
    React.useEffect(() => {
        if (userRole === 'student') {
            setLoadingMistakes(true);
            fetch('http://localhost:8000/api/mistakes/all')
                .then(res => res.json())
                .then(data => setMistakes(data))
                .catch(err => console.error("Failed to load mistakes", err))
                .finally(() => setLoadingMistakes(false));
        }
    }, [userRole]);

    // --- STUDENT VIEW ---
    if (userRole === 'student') {
        const currentXP = 1250;
        const lastWeekXP = 980;
        const xpIncrease = Math.round(((currentXP - lastWeekXP) / lastWeekXP) * 100);

        return (
            <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <header>
                    <h2 className="text-3xl font-black">Your Learning Journey</h2>
                    <p className="text-muted-foreground">Track your stats, XP, and review areas for improvement.</p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* LEFT COLUMN: ACTIVITY & XP */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Activity Graph */}
                        <ActivityGraph logs={weeklyLogs} />

                        {/* XP Stats */}
                        <div className="p-6 bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <TrendingUp className="text-primary" /> XP Improvement
                                </h3>
                                <div className="px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-xs font-black uppercase tracking-widest flex items-center gap-1">
                                    <TrendingUp size={14} /> +{xpIncrease}% this week
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-secondary/50 rounded-2xl space-y-1">
                                    <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Last Week</p>
                                    <p className="text-3xl font-black text-muted-foreground">{lastWeekXP} XP</p>
                                </div>
                                <div className="p-4 bg-primary/10 border border-primary/20 rounded-2xl space-y-1 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-4 opacity-10">
                                        <GraduationCap size={48} />
                                    </div>
                                    <p className="text-xs font-black text-primary uppercase tracking-widest">This Week</p>
                                    <p className="text-3xl font-black text-primary">{currentXP} XP</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: REVIEW MISTAKES */}
                    <div className="space-y-6">
                        <div className="p-6 bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 h-full">
                            <h3 className="text-xl font-bold flex items-center gap-2 mb-6">
                                <AlertCircle className="text-orange-500" /> Review Mistakes
                            </h3>

                            <div className="space-y-4">
                                {loadingMistakes ? (
                                    <div className="py-10 text-center opacity-50">Loading mistakes...</div>
                                ) : mistakes.length === 0 ? (
                                    <div className="py-10 text-center text-muted-foreground italic">No mistakes to review! Great job.</div>
                                ) : (
                                    mistakes.slice(0, 5).map((mistake, idx) => (
                                        <div key={idx} className="p-4 bg-secondary/30 border border-border rounded-2xl space-y-3 hover:border-primary/50 transition-colors group">
                                            <div className="space-y-1">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                    Level {mistake.level} • {mistake.session_id ? 'Section' : 'General'}
                                                </span>
                                                <p className="font-bold text-sm leading-tight">{mistake.question}</p>
                                            </div>

                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-red-500 font-bold line-through opacity-70">{mistake.user_answer}</span>
                                                <ArrowRight size={12} className="text-muted-foreground" />
                                                <span className="text-green-500 font-bold">{mistake.correct_answer}</span>
                                            </div>

                                            <button className="w-full py-2 bg-primary/10 text-primary rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2">
                                                <PlayCircle size={14} /> Review Concept
                                            </button>
                                        </div>
                                    ))
                                )}
                                {mistakes.length > 5 && (
                                    <p className="text-center text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                                        + {mistakes.length - 5} more mistakes to review
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const handleCreateClass = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = await onCreateClass(formData.subjectName, formData.batchYear, formData.grade);
        if (code) {
            setCreatedCode(code);
        }
    };

    const resetForm = () => {
        setIsCreatingClass(false);
        setCreatedCode(null);
        setFormData({ subjectName: '', batchYear: '', grade: '' });
    };

    const selectedClass = selectedClassId ? topics.find(t => t.id === selectedClassId) : null;

    if (isCreatingClass) {
        return (
            <div className="p-6 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <header className="space-y-1">
                    <button
                        onClick={resetForm}
                        className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors mb-2"
                    >
                        <ArrowLeft size={16} /> Back to Classes
                    </button>
                    <h2 className="text-3xl font-black">Start New Class</h2>
                    <p className="text-muted-foreground">Fill in the details to create a new learning environment.</p>
                </header>

                <div className="bg-card border border-border rounded-3xl p-8 shadow-xl">
                    {!createdCode ? (
                        <form onSubmit={handleCreateClass} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Subject Name</label>
                                <input
                                    required
                                    type="text"
                                    placeholder="e.g. Advanced Astrophysics"
                                    className="w-full px-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-medium"
                                    value={formData.subjectName}
                                    onChange={(e) => setFormData({ ...formData, subjectName: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Batch Year</label>
                                    <input
                                        required
                                        type="text"
                                        placeholder="e.g. 2024-25"
                                        className="w-full px-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-medium"
                                        value={formData.batchYear}
                                        onChange={(e) => setFormData({ ...formData, batchYear: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Grade / Level</label>
                                    <input
                                        required
                                        type="text"
                                        placeholder="e.g. Undergraduate"
                                        className="w-full px-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-medium"
                                        value={formData.grade}
                                        onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all mt-4"
                            >
                                Generate Enrollment Link
                            </button>
                        </form>
                    ) : (
                        <div className="text-center space-y-6 py-4 animate-in zoom-in-95 duration-300">
                            <div className="w-20 h-20 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                                <Users size={40} />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black">Class Created Successfully!</h3>
                                <p className="text-muted-foreground">Share the enrollment code below with your students.</p>
                            </div>

                            <div className="p-4 bg-secondary/50 border-2 border-dashed border-border rounded-2xl flex items-center justify-center gap-4">
                                <code className="text-3xl font-black text-primary tracking-[0.2em]">{createdCode}</code>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(createdCode || '');
                                        toast.success('Code copied!');
                                    }}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary/90 transition-all shrink-0"
                                >
                                    Copy Code
                                </button>
                            </div>

                            <button
                                onClick={resetForm}
                                className="text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Return to Dashboard
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (selectedClass) {
        return (
            <div className="h-full flex flex-col bg-background animate-in fade-in">
                <div className="p-6 border-b border-border flex items-center gap-4">
                    <button
                        onClick={() => setSelectedClassId(null)}
                        className="p-2 hover:bg-accent rounded-full transition-all hover:scale-110 active:scale-90"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-black">Class Insights: {selectedClass.title}</h2>
                        <p className="text-sm text-muted-foreground font-medium">Analytics and student performance metrics</p>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-8">
                    <TeacherAnalyticsDashboard sessionId={selectedClass.id} />
                </div>
            </div>
        );
    }

    // Teacher View - Class List
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header>
                <h2 className="text-3xl font-black">Your Classes</h2>
                <p className="text-muted-foreground">Overview of all active classes and their overall learning progress.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {topics.map((cls) => (
                    <div
                        key={cls.id}
                        onClick={() => setSelectedClassId(cls.id)}
                        className="group p-6 bg-card border border-border rounded-3xl hover:border-primary transition-all cursor-pointer hover:shadow-2xl hover:shadow-primary/5 flex flex-col h-full"
                    >
                        <div className="flex items-start justify-between mb-6">
                            <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                <GraduationCap size={30} />
                            </div>
                            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-muted-foreground bg-muted px-3 py-1.5 rounded-xl">
                                <Users size={14} /> {cls.joinedStudentCount || 0} Students
                            </span>
                        </div>

                        <div className="flex-1 space-y-2 mb-6 text-left">
                            <h3 className="text-xl font-bold group-hover:text-primary transition-colors">{cls.title}</h3>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground font-medium">
                                <span className="flex items-center gap-1"><Clock size={14} /> 0 active today</span>
                            </div>
                        </div>

                        <div className="space-y-4 pt-6 border-t border-border">
                            <div className="flex justify-between items-end">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Global Progress</p>
                                    <p className="text-2xl font-black">0%</p>
                                </div>
                                <div className="text-primary group-hover:translate-x-1 transition-transform">
                                    <ChevronRight size={24} />
                                </div>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-500 group-hover:bg-blue-500"
                                    style={{ width: `0 % ` }}
                                />
                            </div>
                        </div>
                    </div>
                ))}

                {/* Create New Class Button */}
                <button
                    onClick={() => setIsCreatingClass(true)}
                    className="p-6 border-2 border-dashed border-border rounded-3xl flex flex-col items-center justify-center gap-4 text-muted-foreground hover:text-primary hover:border-primary transition-all group min-h-[300px]"
                >
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                        <Users size={32} />
                    </div>
                    <div className="text-center">
                        <p className="font-bold text-lg">Start New Class</p>
                        <p className="text-sm opacity-70">Expand your teaching reach</p>
                    </div>
                </button>
            </div>
        </div>
    );
};
