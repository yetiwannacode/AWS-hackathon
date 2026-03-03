import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle, ChevronRight, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';

interface Mistake {
    question: string;
    correct_answer: string;
    explanation: string;
    user_answer: string;
    level: number;
    comments: string;
    timestamp: string;
}

interface MistakesViewProps {
    sessionId: string;
    onBack: () => void;
}

export const MistakesView: React.FC<MistakesViewProps> = ({ sessionId, onBack }) => {
    const [mistakes, setMistakes] = useState<Mistake[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingComment, setEditingComment] = useState<{ question: string, text: string } | null>(null);
    const authHeaders = () => {
        const token = localStorage.getItem('cote_auth_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    useEffect(() => {
        fetchMistakes();
    }, [sessionId]);

    const fetchMistakes = async () => {
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:8000/api/mistakes/${sessionId}`, {
                headers: authHeaders()
            });
            const data = await res.json();
            setMistakes(data);
        } catch (error) {
            console.error("Failed to fetch mistakes", error);
            toast.error("Failed to load mistakes.");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveComment = async (question: string) => {
        if (!editingComment) return;
        try {
            const res = await fetch('http://localhost:8000/api/mistakes/comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    session_id: sessionId,
                    question: question,
                    comment: editingComment.text
                })
            });
            if (res.ok) {
                toast.success("Comment saved!");
                setMistakes(prev => prev.map(m =>
                    m.question === question ? { ...m, comments: editingComment.text } : m
                ));
                setEditingComment(null);
            }
        } catch (error) {
            toast.error("Failed to save comment.");
        }
    };

    return (
        <div className="p-8 max-w-5xl mx-auto min-h-screen">
            <button
                onClick={onBack}
                className="self-start mb-6 text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
            >
                <ChevronRight className="rotate-180" size={16} /> Back to Quest Map
            </button>

            <header className="mb-12">
                <h2 className="text-3xl font-black bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                    Mistakes Repository
                </h2>
                <p className="text-muted-foreground">Review your past errors, understand the explanations, and add your own notes.</p>
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : mistakes.length === 0 ? (
                <div className="text-center py-20 bg-card rounded-2xl border border-dashed border-border">
                    <CheckCircle size={48} className="mx-auto mb-4 text-green-500 opacity-50" />
                    <h3 className="text-xl font-bold">No mistakes yet!</h3>
                    <p className="text-muted-foreground">Keep up the great work. Your errors will appear here for review.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {mistakes.map((mistake, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
                        >
                            <div className="p-6 border-b border-border bg-muted/30">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex gap-3">
                                        <AlertCircle className="text-red-500 shrink-0 mt-1" size={20} />
                                        <h4 className="text-lg font-bold leading-tight">{mistake.question}</h4>
                                    </div>
                                    <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-bold whitespace-nowrap">
                                        Level {mistake.level}
                                    </span>
                                </div>
                            </div>

                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Your Answer</div>
                                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 font-medium">
                                            {mistake.user_answer}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Correct Answer</div>
                                        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-600 font-medium">
                                            {mistake.correct_answer}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Explanation</div>
                                        <p className="text-sm leading-relaxed text-foreground/80 bg-accent/30 p-4 rounded-xl italic">
                                            "{mistake.explanation || "No explanation available for this question."}"
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 bg-muted/30 border-t border-border mt-auto">
                                <div className="flex items-center gap-2 mb-3 text-sm font-bold text-primary italic">
                                    <MessageSquare size={16} /> Student Notes
                                </div>

                                {editingComment?.question === mistake.question ? (
                                    <div className="flex gap-2">
                                        <textarea
                                            className="flex-1 p-3 rounded-xl border border-primary/30 bg-background text-sm focus:ring-2 focus:ring-primary outline-none min-h-[80px]"
                                            placeholder="Add your own notes or mnemonic to remember this..."
                                            value={editingComment.text}
                                            onChange={(e) => setEditingComment({ ...editingComment, text: e.target.value })}
                                        />
                                        <button
                                            onClick={() => handleSaveComment(mistake.question)}
                                            className="self-end p-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
                                        >
                                            <Send size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => setEditingComment({ question: mistake.question, text: mistake.comments || '' })}
                                        className="group cursor-pointer min-h-[40px] p-3 rounded-xl border border-dashed border-border bg-background/50 hover:border-primary/50 transition-all"
                                    >
                                        {mistake.comments ? (
                                            <p className="text-sm">{mistake.comments}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground italic">No notes added. Click to add a comment...</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};
