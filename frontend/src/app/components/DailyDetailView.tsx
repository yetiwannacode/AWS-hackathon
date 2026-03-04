import React from 'react';
import {
    ArrowLeft,
    BookOpen,
    Youtube,
    Lightbulb,
    CheckCircle2,
    ExternalLink,
    Play,
    X
} from 'lucide-react';
import { toast } from 'sonner';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Day {
    day_number: number;
    topic: string;
    learning_objectives: string[];
    youtube_video_title?: string;
    youtube_video_url?: string;
    youtube_search_term: string;
    practice_source?: 'hackerrank' | 'leetcode' | 'ai_generated' | '';
    practice_url?: string;
    practice_question?: { question?: string; hint?: string } | null;
    reference_content: string;
    questions: { question: string; type: string; hint?: string }[];
}

interface DailyDetailViewProps {
    day: Day;
    roadmapId: string;
    onBack: () => void;
    onComplete: () => void;
}

export const DailyDetailView: React.FC<DailyDetailViewProps> = ({
    day,
    roadmapId,
    onBack,
    onComplete
}) => {
    const [isCompleted, setIsCompleted] = React.useState(false);
    const [selectedHint, setSelectedHint] = React.useState<string | null>(null);

    const handleComplete = async () => {
        try {
            const response = await fetch(`http://localhost:8000/api/roadmap/${roadmapId}/complete_day`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ day_number: day.day_number })
            });
            if (response.ok) {
                toast.success(`Day ${day.day_number} completed!`);
                setIsCompleted(true);
                onComplete();
            }
        } catch (error) {
            toast.error("Failed to mark day as completed");
        }
    };

    const videoUrl = day.youtube_video_url ||
        (day.youtube_search_term ? `https://www.youtube.com/results?search_query=${encodeURIComponent(day.youtube_search_term)}` :
            `https://www.youtube.com/results?search_query=${encodeURIComponent(day.topic)}`);

    const videoTitle = day.youtube_video_title || `${day.topic} - Highly Rated Tutorials`;
    const secondaryText = day.youtube_video_url ? 'Recommended Video' : (day.youtube_search_term ? `Search: "${day.youtube_search_term}"` : 'Recommended Topic Search');
    const practiceSource = (day.practice_source || '').toLowerCase();
    const practiceSourceLabel =
        practiceSource === 'leetcode'
            ? 'LeetCode'
            : practiceSource === 'hackerrank'
                ? 'HackerRank'
                : practiceSource === 'ai_generated'
                    ? 'AI Recommendation'
                    : (day.practice_url?.includes('leetcode.com') ? 'LeetCode' : 'HackerRank');
    const hasPracticeBlock = Boolean(day.practice_url || day.practice_question?.question);

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-right-4 duration-700">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors font-bold uppercase tracking-widest text-xs"
            >
                <ArrowLeft size={16} /> Back to Roadmap
            </button>

            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <p className="text-primary font-black uppercase tracking-[0.3em] text-sm">DAY {day.day_number}</p>
                    <h1 className="text-5xl font-black tracking-tighter">{day.topic}</h1>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {day.learning_objectives.map((obj, i) => (
                            <span key={i} className="px-3 py-1 bg-primary/10 text-primary rounded-lg text-xs font-bold ring-1 ring-primary/20">
                                {obj}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex-shrink-0">
                    <button
                        onClick={handleComplete}
                        disabled={isCompleted}
                        className={`px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-xl transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 ${isCompleted
                            ? 'bg-green-500 text-white cursor-default shadow-green-500/20'
                            : 'bg-primary text-primary-foreground shadow-primary/20 hover:shadow-primary/40'
                            }`}
                    >
                        {isCompleted ? (
                            <>
                                <CheckCircle2 size={18} /> COMPLETED
                            </>
                        ) : (
                            "MARK AS DONE"
                        )}
                    </button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <section className="bg-card border border-border rounded-[2rem] p-8 shadow-sm space-y-6">
                        <div className="flex items-center gap-3 text-primary">
                            <BookOpen size={24} />
                            <h2 className="text-2xl font-black uppercase tracking-tight">Essential Reading</h2>
                        </div>
                        <div className="prose prose-invert max-w-none text-muted-foreground leading-relayed font-medium">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    pre: ({ node, ...props }) => (
                                        <div className="relative my-6 rounded-2xl overflow-hidden bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
                                            <pre className="p-6 overflow-auto text-sm leading-relaxed" {...props} />
                                        </div>
                                    ),
                                    code: ({ node, inline, className, children, ...props }: any) => {
                                        if (inline) {
                                            return (
                                                <code className="px-1.5 py-0.5 rounded-md bg-white/10 text-primary font-bold text-[0.9em]" {...props}>
                                                    {children}
                                                </code>
                                            );
                                        }
                                        return (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    },
                                    h1: ({ node, ...props }) => <h1 className="text-3xl font-black tracking-tighter mt-8 mb-4 text-foreground" {...props} />,
                                    h2: ({ node, ...props }) => <h2 className="text-2xl font-black tracking-tight mt-6 mb-3 text-foreground" {...props} />,
                                    h3: ({ node, ...props }) => <h3 className="text-xl font-bold tracking-tight mt-4 mb-2 text-foreground" {...props} />,
                                    p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-4 space-y-1" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-4 space-y-1" {...props} />,
                                    li: ({ node, ...props }) => <li className="ml-4" {...props} />,
                                    strong: ({ node, ...props }) => <strong className="font-black text-primary" {...props} />,
                                    blockquote: ({ node, ...props }) => (
                                        <blockquote className="border-l-4 border-primary pl-4 py-1 italic opacity-80 mb-4" {...props} />
                                    ),
                                }}
                            >
                                {day.reference_content}
                            </ReactMarkdown>
                        </div>
                    </section>

                    <section className="bg-orange-500/5 border border-orange-500/10 rounded-[2rem] p-8 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-orange-500">
                                <Youtube size={28} />
                                <h2 className="text-2xl font-black uppercase tracking-tight">Recommended Videos</h2>
                            </div>
                            <a
                                href={videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-500 hover:underline"
                            >
                                Open YouTube <ExternalLink size={14} />
                            </a>
                        </div>
                        <a
                            href={videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-background/50 rounded-2xl p-6 border border-orange-500/20 flex items-center justify-between group cursor-pointer hover:border-orange-500 transition-all block w-full"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-10 bg-orange-500 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform flex-shrink-0">
                                    <Play size={20} fill="currentColor" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold truncate">{videoTitle}</p>
                                    <p className="text-xs text-muted-foreground truncate">{secondaryText}</p>
                                </div>
                            </div>
                            <ArrowLeft className="rotate-180 text-orange-500 flex-shrink-0 ml-4" size={20} />
                        </a>
                        <p className="text-xs text-muted-foreground italic font-medium">
                            Tip: Look for videos with over 100k+ views and positive comments for the best learning experience.
                        </p>
                    </section>
                </div>

                <div className="space-y-8">
                    {hasPracticeBlock && (
                        <section className="bg-emerald-500/5 border border-emerald-500/10 rounded-[2rem] p-8 space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-emerald-500">
                                    <div className="p-2 bg-emerald-500/10 rounded-xl">
                                        <ExternalLink size={24} />
                                    </div>
                                    <h2 className="text-2xl font-black uppercase tracking-tight">Hands-on Practice</h2>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                                Ready to apply what you've learned? Use the recommended practice resource below.
                            </p>
                            {day.practice_url && (
                                <a
                                    href={day.practice_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="bg-emerald-500 text-white rounded-2xl p-6 border border-emerald-500/20 flex items-center justify-between group cursor-pointer hover:bg-emerald-600 transition-all w-full shadow-lg shadow-emerald-500/20"
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform flex-shrink-0">
                                            <Play size={24} fill="currentColor" className="ml-1" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-extrabold uppercase tracking-widest text-sm">Start Practice</p>
                                            <p className="text-xs text-white/80 font-bold truncate">{practiceSourceLabel}: {day.topic}</p>
                                        </div>
                                    </div>
                                    <ArrowLeft className="rotate-180 text-white flex-shrink-0 ml-4" size={20} />
                                </a>
                            )}
                            {!day.practice_url && day.practice_question?.question && (
                                <div className="bg-background/70 border border-emerald-500/20 rounded-2xl p-5 space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/70">{practiceSourceLabel}</p>
                                    <p className="font-bold leading-relaxed">{day.practice_question.question}</p>
                                    {day.practice_question.hint && (
                                        <p className="text-xs text-muted-foreground font-medium">
                                            Hint: {day.practice_question.hint}
                                        </p>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    <section className="bg-green-500/5 border border-green-500/10 rounded-[2rem] p-8 space-y-6">
                        <div className="flex items-center gap-3 text-green-500">
                            <Lightbulb size={24} />
                            <h2 className="text-2xl font-black uppercase tracking-tight">Checkpoint</h2>
                        </div>
                        <div className="space-y-6">
                            {day.questions.map((q, i) => (
                                <div key={i} className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-green-500/60">{q.type}</p>
                                    <p className="font-bold leading-snug">{q.question}</p>
                                    <div className="pt-2">
                                        <button
                                            onClick={() => setSelectedHint(q.hint || "No hint available for this question.")}
                                            className="text-xs font-black text-green-500 uppercase tracking-widest hover:underline opacity-50 hover:opacity-100 transition-all"
                                        >
                                            Reveal Hint
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>

            {/* Hint Modal Container */}
            {selectedHint && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
                    <div
                        className="absolute inset-0 bg-background/80 backdrop-blur-xl"
                        onClick={() => setSelectedHint(null)}
                    />
                    <div className="relative w-full max-w-xl bg-card border border-border rounded-[2.5rem] shadow-2xl p-8 sm:p-10 space-y-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-500">
                        <button
                            onClick={() => setSelectedHint(null)}
                            className="absolute top-6 right-6 p-2 rounded-full hover:bg-secondary transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="flex items-center gap-3 text-green-500">
                            <Lightbulb size={24} className="fill-current" />
                            <h2 className="text-2xl font-black uppercase tracking-tight">The Answer</h2>
                        </div>

                        <div className="bg-secondary/30 rounded-3xl p-6 border border-border">
                            <p className="text-lg font-medium leading-relaxed whitespace-pre-wrap">
                                {selectedHint}
                            </p>
                        </div>

                        <button
                            onClick={() => setSelectedHint(null)}
                            className="w-full py-4 bg-green-500 text-white rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-green-500/20"
                        >
                            Got it!
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
