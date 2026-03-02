import React, { useState, useEffect } from 'react';
import { Trophy, Lock, Star, ChevronRight, Map, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { AssessmentModal } from './AssessmentModal';
import { RemedialModal } from './RemedialModal';
import { MistakesView } from './MistakesView';
import { TeacherAssessmentPreview } from './TeacherAssessmentPreview';

interface AssessmentPathViewProps {
    userRole: 'teacher' | 'student' | null;
    topics?: any[];
}

interface PracticeQuestion {
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
}

interface RemedialPlan {
    diagnosis: string;
    explanation: string;
    practice_question: PracticeQuestion;
}

interface Progress {
    xp: number;
    unlocked_level: number;
    current_chapter_title?: string;
    next_chapter_title?: string;
    cooldown_remaining?: number;
    remedial_plan?: RemedialPlan;
    history: {
        score: number;
        timestamp: string;
        level: number;
    }[];
}

export const AssessmentPathView: React.FC<AssessmentPathViewProps> = ({ userRole, topics }: AssessmentPathViewProps) => {
    const [classrooms, setClassrooms] = useState<string[]>([]);
    const [selectedClassroom, setSelectedClassroom] = useState<string | null>(null);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [view, setView] = useState<'quest' | 'mistakes'>('quest');


    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
    const [isRemedialOpen, setIsRemedialOpen] = useState(false);

    // Fetch Classrooms on mount
    useEffect(() => {
        fetch('http://127.0.0.1:8000/api/classrooms')
            .then(res => res.json())
            .then(data => setClassrooms(data.classrooms || []))
            .catch(err => console.error("Failed to load classrooms", err));
    }, []);

    // Fetch Progress when classroom is selected
    useEffect(() => {
        if (selectedClassroom) {
            fetchProgress();
        }
    }, [selectedClassroom]);

    const fetchProgress = () => {
        if (!selectedClassroom) return;
        fetch(`http://127.0.0.1:8000/api/progress/${selectedClassroom}`)
            .then(res => res.json())
            .then(data => {
                setProgress(data);
            })
            .catch(err => {
                console.error(err);
            });
    };

    const handleLevelClick = (level: number) => {
        if (progress?.cooldown_remaining && progress.cooldown_remaining > 0 && level === progress.unlocked_level) {
            setIsRemedialOpen(true);
            return;
        }

        if (progress && progress.unlocked_level >= level) {
            setSelectedLevel(level);
            setIsModalOpen(true);
        }
    };

    const handleQuizComplete = () => {
        setIsModalOpen(false);
        fetchProgress(); // Refresh to see new XP/Levels
    };

    // Sync Cooldown Locally
    useEffect(() => {
        if (!selectedClassroom || !progress?.cooldown_remaining || progress.cooldown_remaining <= 0) return;

        const timer = setInterval(() => {
            setProgress((prev: Progress | null) => {
                if (!prev || !prev.cooldown_remaining || prev.cooldown_remaining <= 0) {
                    clearInterval(timer);
                    return prev;
                }
                return { ...prev, cooldown_remaining: prev.cooldown_remaining - 1 };
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [selectedClassroom, (progress?.cooldown_remaining ?? 0) > 0]);

    // If teacher, show TeacherAssessmentPreview directly
    if (userRole === 'teacher' && selectedClassroom) {
        return <TeacherAssessmentPreview sessionId={selectedClassroom} onBack={() => setSelectedClassroom(null)} />;
    }

    // --- VIEW: CLASSROOM SELECTION ---
    if (!selectedClassroom) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-black text-foreground">
                        Select a Classroom Quest
                    </h1>
                    <div className="flex bg-muted p-1 rounded-xl">
                        <button
                            onClick={() => setView('quest')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'quest' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Quest Map
                        </button>
                        <button
                            onClick={() => setView('mistakes')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'mistakes' ? 'bg-red-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Global Mistakes
                        </button>
                    </div>
                </div>

                {view === 'mistakes' ? (
                    <MistakesView
                        sessionId="all"
                        onBack={() => setView('quest')}
                    />
                ) : classrooms.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <Map size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No classrooms found. Upload some materials first!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {classrooms.map((cls: string) => (
                            <motion.div
                                key={cls}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setSelectedClassroom(cls)}
                                className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:shadow-lg cursor-pointer transition-all group relative overflow-hidden"
                            >
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <BookOpen size={64} />
                                </div>
                                <h3 className="text-xl font-black mb-2 text-primary dark:text-purple-400 drop-shadow-sm">
                                    Artificial Intelligence
                                </h3>
                                <div className="flex items-center text-primary font-medium">
                                    <span>Enter Path</span>
                                    <ChevronRight size={16} className="ml-1" />
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="p-8 max-w-5xl mx-auto min-h-screen flex flex-col">
            <button
                onClick={() => setSelectedClassroom(null)}
                className="self-start mb-6 text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
            >
                <ChevronRight className="rotate-180" size={16} /> Back to Classrooms
            </button>

            <header className="flex items-center justify-between mb-12 bg-card p-6 rounded-2xl border border-border shadow-sm">
                <div className="flex-1">
                    <h2 className="text-2xl font-black text-primary dark:text-purple-400">
                        Artificial Intelligence
                    </h2>
                    {progress?.current_chapter_title && (
                        <div className="flex items-center gap-3 mt-3 text-primary bg-primary/10 px-4 py-2 rounded-xl w-fit border border-primary/20">
                            <BookOpen size={20} />
                            <span className="font-black text-lg">Current Quest: {progress.current_chapter_title}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-4 mt-4">
                        <button
                            onClick={() => setView('quest')}
                            className={`text-sm font-bold px-3 py-1 rounded-full transition-all ${view === 'quest' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                        >
                            Quest Path
                        </button>
                        <button
                            onClick={() => setView('mistakes')}
                            className={`text-sm font-bold px-3 py-1 rounded-full transition-all ${view === 'mistakes' ? 'bg-red-500 text-white' : 'text-muted-foreground hover:bg-accent'}`}
                        >
                            Mistakes
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {progress?.next_chapter_title && (
                        <div className="hidden md:flex flex-col items-end mr-4 opacity-70">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Up Next</span>
                            <span className="text-xs font-bold flex items-center gap-1">
                                <Lock size={10} /> {progress.next_chapter_title}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 bg-yellow-500/10 text-yellow-600 px-4 py-2 rounded-full font-bold border border-yellow-500/20">
                        <Star className="fill-current" size={18} />
                        <span>{progress?.xp || 0} XP</span>
                    </div>
                    <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-bold border border-primary/20">
                        <Trophy size={18} />
                        <span>Level {progress?.unlocked_level || 1}</span>
                    </div>
                </div>
            </header>

            {view === 'quest' ? (
                <div className="flex-1 relative flex flex-col items-center justify-center gap-16 py-12">
                    {/* Connecting Line */}
                    <div className="absolute left-1/2 top-24 bottom-24 w-1 bg-border -z-10 transform -translate-x-1/2" />

                    {/* Level 1 Node */}
                    <LevelNode
                        level={1}
                        title="Recall & Remember"
                        desc="Test your basic knowledge."
                        unlocked={true}
                        currentLevel={progress?.unlocked_level || 1}
                        onClick={() => handleLevelClick(1)}
                        isRemedial={(progress?.cooldown_remaining || 0) > 0 && (progress?.unlocked_level || 1) === 1}
                    />

                    {/* Level 2 Node */}
                    <LevelNode
                        level={2}
                        title="Apply & Analyze"
                        desc="Solve scenarios and case studies."
                        unlocked={(progress?.unlocked_level || 1) >= 2}
                        currentLevel={progress?.unlocked_level || 1}
                        onClick={() => handleLevelClick(2)}
                        isRemedial={(progress?.cooldown_remaining || 0) > 0 && (progress?.unlocked_level || 1) === 2}
                    />

                    {/* Level 3 Node */}
                    <LevelNode
                        level={3}
                        title="Create & Evaluate"
                        desc="Propose solutions to complex problems."
                        unlocked={(progress?.unlocked_level || 1) >= 3}
                        currentLevel={progress?.unlocked_level || 1}
                        onClick={() => handleLevelClick(3)}
                        isLast
                        isRemedial={(progress?.cooldown_remaining || 0) > 0 && (progress?.unlocked_level || 1) === 3}
                    />
                </div>
            ) : (
                <MistakesView
                    sessionId={selectedClassroom}
                    onBack={() => setView('quest')}
                />
            )}

            {selectedLevel && (
                <AssessmentModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    level={selectedLevel}
                    sessionId={selectedClassroom}
                    onComplete={handleQuizComplete}
                />
            )}
            <RemedialModal
                isOpen={isRemedialOpen}
                onClose={() => setIsRemedialOpen(false)}
                plan={progress?.remedial_plan ?? null}
                cooldownRemaining={progress?.cooldown_remaining ?? 0}
                sessionId={selectedClassroom || ''}
                onSuccess={() => {
                    setIsRemedialOpen(false);
                    fetchProgress();
                }}
            />
        </div>
    );
};

const LevelNode = ({ level, title, desc, unlocked, currentLevel, onClick, isRemedial }: any) => {
    const isCompleted = currentLevel > level;
    const isActive = currentLevel === level;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative z-10 flex flex-col items-center text-center max-w-xs ${!unlocked ? 'opacity-50 grayscale' : ''}`}
        >
            <motion.button
                whileHover={unlocked ? { scale: 1.1 } : {}}
                whileTap={unlocked ? { scale: 0.95 } : {}}
                onClick={onClick}
                disabled={!unlocked}
                className={`w-24 h-24 rounded-full flex items-center justify-center border-4 shadow-xl transition-all ${unlocked
                    ? 'bg-card border-primary text-primary hover:shadow-primary/50'
                    : 'bg-muted border-muted-foreground text-muted-foreground cursor-not-allowed'
                    } ${isActive ? 'ring-4 ring-primary/30 ring-offset-4 ring-offset-background' : ''}`}
            >
                {unlocked ? (
                    <span className="text-3xl font-black">{level}</span>
                ) : (
                    <Lock size={32} />
                )}
            </motion.button>

            <div className={`mt-4 bg-card px-6 py-3 rounded-xl border shadow-sm ${isRemedial ? "border-red-500 bg-red-500/5" : "border-border"}`}>
                <h3 className="font-bold text-lg">{title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                {isRemedial && (
                    <div className="mt-2 text-xs font-bold text-red-500 animate-pulse uppercase tracking-wider">
                        ⚠️ Remedial Mode Active
                    </div>
                )}
                {unlocked && !isRemedial && (
                    <div className="mt-2 text-xs font-semibold text-primary uppercase tracking-wider">
                        {isCompleted ? "Completed" : "Available"}
                    </div>
                )}
            </div>
        </motion.div>
    );
};
