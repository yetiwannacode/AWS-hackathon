import React from 'react';
import {
    ChevronRight,
    CheckCircle2,
    Circle,
    ArrowLeft,
    Lock
} from 'lucide-react';
import { toast } from 'sonner';

interface Day {
    day_number: number;
    topic: string;
    learning_objectives: string[];
    youtube_search_term: string;
    reference_content: string;
}

interface Week {
    week_number: number;
    goal: string;
    days: Day[];
}

interface Roadmap {
    id: string;
    title: string;
    description: string;
    weeks: Week[];
    days_completed: number;
    total_days: number;
}

interface CoursePageViewProps {
    roadmap: Roadmap;
    onBack: () => void;
    onSelectDay: (day: Day) => void;
    completedDays: number[];
    onRoadmapRefresh?: () => void;
}

export const CoursePageView: React.FC<CoursePageViewProps> = ({
    roadmap,
    onBack,
    onSelectDay,
    completedDays,
    onRoadmapRefresh
}) => {
    const [isGenerating, setIsGenerating] = React.useState(false);

    // Local roadmap state — mirrors the prop but can be updated immediately
    // after generation completes, so locks/labels are removed instantly.
    const [localRoadmap, setLocalRoadmap] = React.useState(roadmap);
    React.useEffect(() => { setLocalRoadmap(roadmap); }, [roadmap]);

    const handleGenerateWeek = async (weekNum: number) => {
        setIsGenerating(true);
        const toastId = toast.loading(`Generating content for Week ${weekNum}... This might take a minute.`);
        try {
            const response = await fetch(`http://localhost:8000/api/roadmap/${localRoadmap.id}/generate_week`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ week_number: weekNum })
            });

            if (response.ok) {
                const result = await response.json();

                // Immediately update local state with the returned roadmap
                // so locks and "requires generation" labels are removed
                if (result.roadmap) {
                    setLocalRoadmap(result.roadmap);
                }

                if (result.status === 'partial') {
                    const failedCount = result.failed_days.length;
                    // Format errors for the toast
                    const errorSummary = Object.entries(result.error_details)
                        .map(([day, error]) => `Day ${day}: ${String(error).split('\n')[0]}`) // Just first line of error
                        .join('\n');

                    toast.error(`Week ${weekNum} partially failed. ${failedCount} days failed:\n${errorSummary}`, {
                        id: toastId,
                        duration: 8000
                    });
                } else {
                    toast.success(`Week ${weekNum} is ready!`, { id: toastId });
                }

                // Also trigger parent refresh to keep App-level state in sync
                onRoadmapRefresh?.();
            } else {
                toast.error("Failed to generate week content.", { id: toastId });
            }
        } catch (error) {
            toast.error("Network error while generating week.", { id: toastId });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors font-bold uppercase tracking-widest text-xs"
            >
                <ArrowLeft size={16} /> Back to Studio
            </button>

            <header className="space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-4xl font-black tracking-tight">{localRoadmap.title}</h1>
                </div>
                <p className="text-xl text-muted-foreground font-medium max-w-3xl">
                    {localRoadmap.description}
                </p>
                <div className="flex items-center gap-6 pt-2">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Overall Progress</p>
                        <div className="flex items-center gap-3">
                            <div className="w-48 h-2 bg-accent rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-1000"
                                    style={{ width: `${(completedDays.length / localRoadmap.total_days) * 100}% ` }}
                                />
                            </div>
                            <span className="font-black text-primary">{Math.round((completedDays.length / localRoadmap.total_days) * 100)}%</span>
                        </div>
                    </div>
                    <div className="px-6 border-l border-border space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Days Completed</p>
                        <p className="font-black text-2xl">{completedDays.length} / {localRoadmap.total_days}</p>
                    </div>
                </div>
            </header>

            <div className="space-y-12">
                {localRoadmap.weeks.map((week) => (
                    <section key={week.week_number} className="space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center font-black text-xl">
                                W{week.week_number}
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-tight">Week {week.week_number}</h2>
                                <p className="text-muted-foreground font-medium">{week.goal}</p>
                            </div>
                        </div>

                        <div className="grid gap-4 ml-6 pl-6 border-l-2 border-primary/10">
                            {week.days.map((day) => {
                                const isCompleted = completedDays.includes(day.day_number);
                                const isNext = day.day_number === (completedDays.length > 0 ? Math.max(...completedDays) + 1 : 1);
                                const needsGeneration = day.reference_content === "CONTENT_NOT_GENERATED";
                                const isLocked = needsGeneration && !isGenerating;

                                return (
                                    <button
                                        key={day.day_number}
                                        onClick={() => {
                                            if (needsGeneration) {
                                                if (!isGenerating) {
                                                    handleGenerateWeek(week.week_number);
                                                }
                                                return;
                                            }
                                            onSelectDay(day);
                                        }}
                                        disabled={isGenerating && needsGeneration}
                                        className={`flex items - center justify - between p - 6 rounded - 3xl border - 2 transition - all text - left group ${isCompleted
                                            ? 'bg-accent/30 border-transparent opacity-80'
                                            : needsGeneration
                                                ? 'bg-secondary/50 border-border opacity-75 hover:border-primary/50'
                                                : isNext
                                                    ? 'bg-primary/5 border-primary/20 hover:border-primary shadow-xl shadow-primary/5'
                                                    : 'bg-card border-border hover:border-primary/50'
                                            } ${isGenerating && needsGeneration ? 'animate-pulse cursor-not-allowed' : ''}`}
                                    >
                                        <div className="flex items-center gap-6">
                                            <div className={`w - 10 h - 10 rounded - xl flex items - center justify - center transition - colors ${isCompleted ? 'bg-green-500/20 text-green-500' : isLocked ? 'bg-secondary text-muted-foreground' : 'bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                                                } `}>
                                                {isCompleted ? <CheckCircle2 size={24} /> : isLocked ? <Lock size={20} /> : <Circle size={24} />}
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Day {day.day_number}</p>
                                                <h3 className={`font - bold text - lg ${isNext && !needsGeneration ? 'text-primary' : ''} `}>{day.topic}</h3>
                                                {needsGeneration && (
                                                    <span className="inline-block mt-1 text-[10px] font-bold text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                        {isGenerating ? "Generating..." : "Requires Generation"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center">
                                            {needsGeneration ? (
                                                <span className="text-xs font-bold text-primary mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {isGenerating ? "Wait..." : "Generate"}
                                                </span>
                                            ) : null}
                                            <ChevronRight className={`text - muted - foreground group - hover: text - primary group - hover: translate - x - 1 transition - all ${isNext && !needsGeneration ? 'text-primary' : ''} `} />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};
