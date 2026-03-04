import React, { useState, useEffect } from 'react';
import { ArrowLeft, ChevronRight, BrainCircuit, Sparkles, Loader2, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface Flashcard {
    topic: string;
    summary: string;
}

interface FlashcardsViewProps {
    sessionId: string;
    language: string;
    selectedSource?: string;
    isTeacher?: boolean;
    onBack: () => void;
}

export const FlashcardsView: React.FC<FlashcardsViewProps> = ({ sessionId, language, selectedSource = "", isTeacher = false, onBack }) => {
    const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [direction, setDirection] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [editMode, setEditMode] = useState<'manual' | 'ai'>('manual');
    const [editTopic, setEditTopic] = useState('');
    const [editSummary, setEditSummary] = useState('');
    const [aiPrompt, setAiPrompt] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    useEffect(() => {
        if (!selectedSource) {
            return;
        }
        const fetchFlashcards = async () => {
            setLoading(true);
            try {
                const query = new URLSearchParams({ language });
                if (selectedSource) {
                    query.set('source', selectedSource);
                }
                const res = await fetch(`http://localhost:8000/api/flashcards/${sessionId}?${query.toString()}`);
                const data = await res.json();
                setFlashcards(data);
                setCurrentIndex(0);
            } catch (err) {
                console.error("Failed to fetch flashcards", err);
                toast.error("Failed to load flashcards");
            } finally {
                setLoading(false);
            }
        };

        fetchFlashcards();
    }, [sessionId, language, selectedSource]);

    const handleNext = async () => {
        if (currentIndex < flashcards.length - 1) {
            setDirection(1);
            // Award 20 XP
            try {
                await fetch('http://localhost:8000/api/add_xp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, amount: 20 })
                });
                toast.success("+20 XP for learning!", {
                    icon: <Trophy size={16} className="text-yellow-500" />,
                    duration: 2000
                });
            } catch (err) {
                console.error("Failed to add XP", err);
            }

            setCurrentIndex(prev => prev + 1);
        }
    };

    const handlePrevious = () => {
        if (currentIndex > 0) {
            setDirection(-1);
            setCurrentIndex(prev => prev - 1);
            setIsEditing(false); // Close edit mode when navigating
        }
    };

    const handleStartEdit = () => {
        const currentCard = flashcards[currentIndex];
        setEditTopic(currentCard.topic);
        setEditSummary(currentCard.summary);
        setIsEditing(true);
    };

    const handleSaveManual = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`http://localhost:8000/api/flashcards/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    language,
                    index: currentIndex,
                    updated_card: { topic: editTopic, summary: editSummary },
                    source: selectedSource || null
                })
            });
            const result = await res.json();
            if (result.success) {
                setFlashcards(result.flashcards);
                setIsEditing(false);
                toast.success("Flashcard updated manually");
            } else {
                toast.error(result.error || "Update failed");
            }
        } catch (err) {
            toast.error("Failed to save changes");
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefineAI = async () => {
        if (!aiPrompt.trim()) return;
        setIsSaving(true);
        try {
            const res = await fetch(`http://localhost:8000/api/flashcards/ai-edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    language,
                    index: currentIndex,
                    instruction: aiPrompt,
                    source: selectedSource || null
                })
            });
            const result = await res.json();
            if (result.success) {
                setFlashcards(result.flashcards);
                setIsEditing(false);
                setAiPrompt('');
                toast.success("AI refined the flashcard!");
            } else {
                toast.error(result.error || "AI refinement failed");
            }
        } catch (err) {
            toast.error("AI service error");
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
                <p className="text-xl font-black animate-pulse">AI is summarizing your class materials...</p>
            </div>
        );
    }

    if (flashcards.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
                <BrainCircuit size={64} className="text-muted-foreground opacity-20" />
                <div className="space-y-2">
                    <h3 className="text-2xl font-black">No topics found yet</h3>
                    <p className="text-muted-foreground">Make sure you have uploaded classroom materials first!</p>
                </div>
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg"
                >
                    <ArrowLeft size={20} /> Back to Hub
                </button>
            </div>
        );
    }

    const currentCard = flashcards[currentIndex];

    return (
        <div className="max-w-4xl mx-auto h-full flex flex-col p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <button onClick={onBack} className="flex items-center gap-2 text-primary font-black hover:underline group">
                    <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> Back to Hub
                </button>
                <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-600 rounded-full border border-yellow-500/20 text-xs font-black uppercase tracking-widest">
                    <Sparkles size={14} /> AI Summary Revision
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
                <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                        key={currentIndex}
                        custom={direction}
                        initial={{ opacity: 0, x: direction > 0 ? 50 : -50 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: direction > 0 ? -50 : 50 }}
                        transition={{ type: "spring", damping: 20, stiffness: 100 }}
                        className="w-full max-w-2xl bg-card border-2 border-primary/20 rounded-[2.5rem] p-12 shadow-2xl relative overflow-hidden group hover:border-primary/40 transition-colors"
                    >
                        {/* Decorative Background Element */}
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-[5rem] -mr-8 -mt-8 pointer-events-none group-hover:bg-primary/10 transition-colors" />

                        <div className="space-y-8 relative z-10">
                            <div className="flex items-start justify-between">
                                <div className="space-y-2">
                                    <span className="text-primary text-xs font-black uppercase tracking-[0.2em]">Topic {currentIndex + 1} of {flashcards.length}</span>
                                    <h2 className="text-4xl font-black tracking-tight">{currentCard.topic}</h2>
                                </div>
                                {isTeacher && !isEditing && (
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em] opacity-60">AI EDIT</span>
                                        <button
                                            onClick={handleStartEdit}
                                            className="group flex items-center gap-2 px-3 py-3 bg-primary/10 text-primary rounded-xl hover:bg-primary hover:text-primary-foreground hover:px-5 transition-all duration-300 shadow-lg shadow-primary/5 hover:shadow-primary/20"
                                            title="Edit Flashcard"
                                        >
                                            <Sparkles size={18} />
                                            <span className="max-w-0 overflow-hidden whitespace-nowrap font-black text-xs uppercase tracking-widest group-hover:max-w-[60px] transition-all duration-500 ease-in-out">
                                                Edit
                                            </span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {isEditing ? (
                                <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                                    <div className="flex bg-muted p-1 rounded-xl">
                                        <button
                                            onClick={() => setEditMode('manual')}
                                            className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${editMode === 'manual' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground'}`}
                                        >
                                            Manual Edit
                                        </button>
                                        <button
                                            onClick={() => setEditMode('ai')}
                                            className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${editMode === 'ai' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground'}`}
                                        >
                                            AI Refine
                                        </button>
                                    </div>

                                    {editMode === 'manual' ? (
                                        <div className="space-y-4">
                                            <input
                                                value={editTopic}
                                                onChange={(e) => setEditTopic(e.target.value)}
                                                className="w-full bg-muted border-none rounded-xl px-4 py-3 font-bold focus:ring-2 ring-primary/50 text-xl"
                                                placeholder="Topic Title"
                                            />
                                            <textarea
                                                value={editSummary}
                                                onChange={(e) => setEditSummary(e.target.value)}
                                                className="w-full h-40 bg-muted border-none rounded-xl px-4 py-3 font-medium focus:ring-2 ring-primary/50 resize-none text-base"
                                                placeholder="Summary (Supports markdown/bullet points)"
                                            />
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={handleSaveManual}
                                                    disabled={isSaving}
                                                    className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl font-black disabled:opacity-50"
                                                >
                                                    {isSaving ? <Loader2 className="animate-spin mx-auto" /> : 'Save Changes'}
                                                </button>
                                                <button
                                                    onClick={() => setIsEditing(false)}
                                                    className="px-6 border-2 border-muted text-muted-foreground hover:bg-muted py-3 rounded-xl font-black"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="p-4 bg-primary/5 rounded-xl border border-primary/10">
                                                <p className="text-sm font-medium text-primary">Describe how you want to refine this card (e.g., "Make it simpler", "Add more details about formulas").</p>
                                            </div>
                                            <textarea
                                                value={aiPrompt}
                                                onChange={(e) => setAiPrompt(e.target.value)}
                                                className="w-full h-32 bg-muted border-none rounded-xl px-4 py-3 font-medium focus:ring-2 ring-primary/50 resize-none text-base"
                                                placeholder="AI Instructions..."
                                            />
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={handleRefineAI}
                                                    disabled={isSaving || !aiPrompt.trim()}
                                                    className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    {isSaving ? <Loader2 className="animate-spin" /> : <><Sparkles size={18} /> Refine with AI</>}
                                                </button>
                                                <button
                                                    onClick={() => setIsEditing(false)}
                                                    className="px-6 border-2 border-muted text-muted-foreground hover:bg-muted py-3 rounded-xl font-black"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    className="prose prose-sm dark:prose-invert max-w-none text-lg leading-relaxed text-foreground/80 font-medium"
                                    dangerouslySetInnerHTML={{
                                        __html: currentCard.summary
                                            .replace(/\*\*(.*?)\*\*/g, '<b class="text-primary font-black">$1</b>')
                                            .replace(/\n\s*-\s*/g, '<br/>• ')
                                    }}
                                />
                            )}
                        </div>
                    </motion.div>
                </AnimatePresence>

                <div className="mt-12 flex items-center gap-8">
                    <div className="flex items-center gap-2">
                        {flashcards.map((_, idx) => (
                            <div
                                key={idx}
                                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-8 bg-primary' : 'w-2 bg-muted'}`}
                            />
                        ))}
                    </div>

                    <div className="flex items-center gap-4">
                        {currentIndex > 0 && (
                            <button
                                onClick={handlePrevious}
                                className="bg-secondary text-secondary-foreground px-8 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-muted transition-all border border-border hover:border-primary/50 group"
                            >
                                <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" /> Previous
                            </button>
                        )}

                        {currentIndex < flashcards.length - 1 ? (
                            <button
                                onClick={handleNext}
                                className="bg-primary text-primary-foreground px-10 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 group"
                            >
                                Next Topic <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                        ) : (
                            <button
                                onClick={onBack}
                                className="bg-green-600 text-white px-10 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-green-700 transition-all shadow-xl shadow-green-500/20 hover:scale-105 active:scale-95"
                            >
                                Finish Revision <Trophy size={20} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
