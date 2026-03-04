import React, { useState, useEffect } from 'react';
import {
    ArrowLeft,
    FileText,
    BrainCircuit,
    ChevronRight,
    CheckCircle2,
    Users,
    MessageSquare,
    MoreVertical,
    Share2,
    Book,
    Upload,
    UserPlus,
    X,
    Send
} from 'lucide-react';
import { toast } from 'sonner';

import { useActivityTracker } from '../hooks/useActivityTracker';

interface MaterialViewProps {
    topic: any;
    onBack: () => void;
    userRole: 'teacher' | 'student';
    onUploadComplete?: (topicId: string, pdfUrl: string) => void;
    onDeleteMaterial?: (topicId: string, materialId: string, materialTitle?: string) => Promise<boolean>;
}

export const MaterialView: React.FC<MaterialViewProps> = ({ topic, onBack, userRole, onUploadComplete, onDeleteMaterial }) => {
    const [view, setView] = useState<'stream' | 'classwork' | 'people' | 'reading' | 'flashcards' | 'assessment'>('stream');
    const { setIsStudying } = useActivityTracker();
    const [isSharing, setIsSharing] = useState(false);
    const [shareText, setShareText] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Track time specifically when in a study-related view
        const studyViews = ['reading', 'flashcards', 'assessment'];
        if (studyViews.includes(view)) {
            setIsStudying(true);
        } else {
            setIsStudying(false);
        }

        // Cleanup on unmount
        return () => setIsStudying(false);
    }, [view, setIsStudying]);
    const [activeMaterial, setActiveMaterial] = useState<any | null>(null);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [assessmentStep, setAssessmentStep] = useState(0);
    const [assessmentScore, setAssessmentScore] = useState<number | null>(null);
    const [selectedStudentForComment, setSelectedStudentForComment] = useState<any | null>(null);
    const [commentText, setCommentText] = useState('');
    const [openActionMaterialId, setOpenActionMaterialId] = useState<string | null>(null);
    const [classroomPeople, setClassroomPeople] = useState<{ teacher: { id: string; name: string } | null; students: Array<{ id: string; name: string; xp: number }> }>({
        teacher: null,
        students: []
    });
    const [peopleLoading, setPeopleLoading] = useState(false);

    const isTeacher = userRole === 'teacher';

    const handleNextCard = () => {
        setIsFlipped(false);
        setCurrentCardIndex((prev) => (prev + 1) % topic.flashcards.length);
    };

    const handleAssessmentFinish = () => {
        setAssessmentScore(Math.floor(Math.random() * 40) + 60); // Mock score
    };

    const handleDeleteMaterial = async (material: any) => {
        if (!isTeacher || !onDeleteMaterial) return;
        const confirmed = window.confirm(`Delete "${material.title}" from this classroom?`);
        if (!confirmed) return;
        setOpenActionMaterialId(null);
        const filenameFromUrl = material?.url ? decodeURIComponent(String(material.url).split('/').pop() || '') : '';
        const filename = material.title || filenameFromUrl;
        const ok = await onDeleteMaterial(topic.id, material.id, filename);
        if (ok) {
            toast.success('Material deleted.');
            if (activeMaterial?.id === material.id) {
                setActiveMaterial(null);
                setView('stream');
            }
        }
    };

    useEffect(() => {
        if (view !== 'people') return;
        const token = localStorage.getItem('cote_auth_token');
        if (!token || token.startsWith('offline-demo::')) {
            setClassroomPeople({ teacher: null, students: [] });
            return;
        }

        setPeopleLoading(true);
        fetch(`http://localhost:8000/api/classrooms/${topic.id}/people`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Failed to load classroom people.');
                setClassroomPeople({
                    teacher: data.teacher || null,
                    students: data.students || []
                });
            })
            .catch((error: any) => {
                toast.error(error.message || 'Failed to load classroom people.');
            })
            .finally(() => setPeopleLoading(false));
    }, [view, topic.id]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onUploadComplete) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append('files', file);
        formData.append('session_id', topic.id);

        try {
            const response = await fetch('http://localhost:8000/upload', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                // We just pass the filename back to App.tsx, which constructs the URL and Material object
                onUploadComplete(topic.id, file.name);
                toast.success('Material posted to stream!');
                setIsSharing(false);
                setShareText('');
            } else {
                toast.error('Upload failed');
            }
        } catch (error) {
            toast.error('Error uploading file');
        } finally {
            setIsUploading(false);
        }
    };

    const tabs = [
        { id: 'stream', label: 'Stream' },
        { id: 'classwork', label: 'Classwork' },
        { id: 'people', label: 'People' },
        { id: 'grades', label: 'Grades' },
    ];

    return (
        <div className="h-full flex flex-col bg-background overflow-hidden">
            {/* Google Classroom Style Header */}
            <div className="px-6 py-2 border-b border-border flex items-center justify-between bg-card shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-secondary rounded-full transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-lg font-bold truncate max-w-[200px]">{topic.title}</h2>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{topic.description}</p>
                    </div>
                </div>

                <nav className="flex items-center">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setView(tab.id as any)}
                            className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${view === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-secondary rounded-full">
                        <Users size={20} className="text-muted-foreground" />
                    </button>
                    <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
                        {userRole === 'teacher' ? 'T' : 'S'}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-muted/20">
                {view === 'stream' && (
                    <div className="max-w-5xl mx-auto p-6 space-y-6">
                        {/* Banner Section */}
                        <div className="relative h-60 rounded-xl overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 p-8 flex flex-col justify-end text-white shadow-lg">
                            <div className="absolute top-0 right-0 p-4">
                                <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                    <MoreVertical size={20} />
                                </button>
                            </div>
                            <h1 className="text-4xl font-black mb-2">{topic.title}</h1>
                            <p className="text-lg font-medium opacity-90">{topic.description}</p>
                            <div className="mt-4 flex items-center gap-2 text-sm font-bold">
                                <span className="bg-white/20 px-3 py-1 rounded-lg">Class code: {topic.enrollmentCode || 'XXXXX'}</span>
                                <Share2 size={16} className="cursor-pointer hover:scale-110 transition-transform" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            {/* Left Sidebar - Upcoming */}
                            <div className="hidden md:block space-y-4">
                                <div className="p-4 bg-card border border-border rounded-xl shadow-sm">
                                    <h3 className="text-sm font-medium mb-4">Upcoming</h3>
                                    <p className="text-xs text-muted-foreground mb-4">Woohoo, no work due in soon!</p>
                                    <button className="text-xs font-bold text-primary hover:underline float-right">View all</button>
                                    <div className="clear-both"></div>
                                </div>
                            </div>

                            {/* Main Feed */}
                            <div className="md:col-span-3 space-y-6">
                                {/* Share something box */}
                                {isTeacher ? (
                                    <div className={`bg-card border border-border rounded-lg shadow-sm transition-all duration-300 overflow-hidden ${isSharing ? 'ring-2 ring-primary/20' : 'hover:shadow-md'}`}>
                                        {!isSharing ? (
                                            <div
                                                onClick={() => setIsSharing(true)}
                                                className="p-4 flex items-center gap-4 cursor-pointer"
                                            >
                                                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                                                    {isTeacher ? 'T' : 'S'}
                                                </div>
                                                <span className="text-sm text-muted-foreground">Announce something to your class</span>
                                            </div>
                                        ) : (
                                            <div className="p-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                                <textarea
                                                    autoFocus
                                                    value={shareText}
                                                    onChange={(e) => setShareText(e.target.value)}
                                                    placeholder="Announce something to your class..."
                                                    className="w-full bg-secondary/30 border-none focus:ring-0 text-15 font-normal resize-none min-h-[100px] p-4 rounded-xl placeholder:text-muted-foreground"
                                                />

                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    className="hidden"
                                                    accept=".pdf"
                                                    onChange={handleFileUpload}
                                                />

                                                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border mt-4">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            disabled={isUploading}
                                                            onClick={() => fileInputRef.current?.click()}
                                                            className="flex items-center gap-2 px-4 py-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground text-sm font-medium transition-all disabled:opacity-50"
                                                        >
                                                            <Upload size={20} /> Upload
                                                        </button>
                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => { setIsSharing(false); setShareText(''); }}
                                                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (shareText.trim()) {
                                                                    toast.success('Announcement posted!');
                                                                    setIsSharing(false);
                                                                    setShareText('');
                                                                } else {
                                                                    toast.error('Please enter a message first');
                                                                }
                                                            }}
                                                            className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                                                            disabled={!shareText.trim()}
                                                        >
                                                            Post
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : null}

                                {/* Material Posts List */}
                                {topic.materials && topic.materials.map((material: any) => (
                                    <div
                                        key={material.id}
                                        className="bg-card border border-border rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                                    >
                                        {/* Post Header */}
                                        <div className="p-4 flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                                                    T
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium hover:underline cursor-pointer">Professor C.O.T.E</p>
                                                    <p className="text-xs text-muted-foreground">{new Date(material.date).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className="relative">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenActionMaterialId((prev) => prev === material.id ? null : material.id);
                                                    }}
                                                    className="p-2 hover:bg-secondary rounded-full"
                                                >
                                                    <MoreVertical size={20} className="text-muted-foreground" />
                                                </button>
                                                {isTeacher && onDeleteMaterial && openActionMaterialId === material.id && (
                                                    <div className="absolute right-0 top-10 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteMaterial(material);
                                                            }}
                                                            className="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-secondary"
                                                        >
                                                            Delete material
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Post Body */}
                                        <div className="px-4 pb-2">
                                            <p className="text-sm text-foreground/90">{material.description || `Posted new material: ${material.title}`}</p>
                                        </div>

                                        {/* Attachment Card */}
                                        <div className="px-4 pb-4">
                                            <div
                                                onClick={() => { setActiveMaterial(material); setView('reading'); }}
                                                className="mt-3 border border-border rounded-lg overflow-hidden flex cursor-pointer hover:bg-secondary/20 transition-colors group"
                                            >
                                                {/* Thumbnail (Mock) */}
                                                <div className="w-24 bg-muted flex items-center justify-center border-r border-border h-20 group-hover:brightness-95 transition-all">
                                                    <FileText size={32} className="text-red-500" />
                                                </div>
                                                {/* Details */}
                                                <div className="flex-1 p-3 flex flex-col justify-center">
                                                    <h4 className="font-medium text-sm truncate group-hover:text-blue-600 transition-colors">{material.title}</h4>
                                                    <p className="text-xs text-muted-foreground uppercase font-bold mt-1">PDF</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="border-t border-border px-4 py-3">
                                            <button className="text-xs font-bold text-muted-foreground hover:text-foreground">Add class comment...</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {view === 'classwork' && (
                    <div className="max-w-4xl mx-auto p-12 space-y-12">
                        {/* Header ... */}

                        <div className="space-y-4">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Book size={24} className="text-primary" /> Learning Materials
                            </h3>
                            <div className="grid grid-cols-1 gap-3">
                                {topic.materials && topic.materials.map((material: any) => (
                                    <button
                                        key={material.id}
                                        onClick={() => { setActiveMaterial(material); setView('reading'); }}
                                        className="w-full p-6 bg-card border border-border rounded-2xl flex items-center justify-between hover:border-primary transition-all group shadow-sm"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all">
                                                <FileText size={20} />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-bold group-hover:text-primary transition-colors">{material.title}</p>
                                                <p className="text-xs text-muted-foreground font-medium">Reference Material</p>
                                            </div>
                                        </div>
                                        <ChevronRight size={20} className="text-muted-foreground" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Evaluations ... */}
                        {/* ... */}
                    </div>
                )}

                {view === 'people' && (
                    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in duration-500">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-3xl font-black">People</h3>
                                <p className="text-muted-foreground font-medium">Manage students and view their learning progress.</p>
                            </div>
                            {isTeacher && (
                                <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                                    <UserPlus size={18} /> Invite Student
                                </button>
                            )}
                        </div>

                        {/* Teachers List */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-primary py-4">
                                <h4 className="text-2xl font-black text-primary">Teachers</h4>
                                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">{classroomPeople.teacher ? '1 Teacher' : '0 Teacher'}</span>
                            </div>
                            {classroomPeople.teacher ? (
                                <div className="flex items-center gap-4 p-2">
                                    <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-black">
                                        {classroomPeople.teacher.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'T'}
                                    </div>
                                    <span className="font-bold text-lg">{classroomPeople.teacher.name}</span>
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">No teacher information available.</p>
                            )}
                        </div>

                        {/* Students List */}
                        <div className="space-y-6 pt-8">
                            <div className="flex items-center justify-between border-b border-primary py-4">
                                <h4 className="text-2xl font-black text-primary">Students</h4>
                                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                    {isTeacher ? 'Sorted by XP (Highest to Lowest)' : 'Classmates'}
                                </span>
                            </div>

                            {peopleLoading ? (
                                <p className="text-sm text-muted-foreground">Loading classroom members...</p>
                            ) : (
                                <div className="space-y-2">
                                    {classroomPeople.students.length === 0 && (
                                        <p className="text-sm text-muted-foreground">No students have joined this classroom yet.</p>
                                    )}
                                    {classroomPeople.students.map((student, idx) => (
                                        <div key={student.id || idx} className="flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-primary/50 transition-all group">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-black uppercase">
                                                {student.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                                            </div>
                                            <div className="text-left">
                                                <p className="font-bold group-hover:text-primary transition-colors">{student.name}</p>
                                                <p className="text-xs text-muted-foreground font-medium">Enrolled Student</p>
                                            </div>
                                        </div>
                                        {isTeacher && (
                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-sm font-black text-primary">{student.xp} XP</p>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Rank #{idx + 1}</p>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedStudentForComment(student)}
                                                    className="p-2 hover:bg-secondary rounded-full transition-colors"
                                                >
                                                    <MessageSquare size={18} className="text-muted-foreground" />
                                                </button>
                                            </div>
                                        )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Comment Modal */}
                        {selectedStudentForComment && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                                <div className="bg-card border-2 border-border w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
                                    <div className="p-8 space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-white font-black">
                                                    {selectedStudentForComment.name.split(' ').map((n: string) => n[0]).join('')}
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black">Message {selectedStudentForComment.name.split(' ')[0]}</h3>
                                                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Teacher Comment</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => { setSelectedStudentForComment(null); setCommentText(''); }}
                                                className="p-2 hover:bg-secondary rounded-full"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            <textarea
                                                autoFocus
                                                value={commentText}
                                                onChange={(e) => setCommentText(e.target.value)}
                                                placeholder={`Write a word of encouragement or feedback for ${selectedStudentForComment.name}...`}
                                                className="w-full bg-secondary/30 border-2 border-transparent focus:border-primary/20 focus:ring-0 text-15 font-medium resize-none min-h-[150px] p-6 rounded-3xl placeholder:text-muted-foreground transition-all"
                                            />

                                            <div className="flex items-center justify-between gap-4">
                                                <button
                                                    onClick={() => { setSelectedStudentForComment(null); setCommentText(''); }}
                                                    className="px-6 py-3 text-sm font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    disabled={!commentText.trim()}
                                                    onClick={() => {
                                                        toast.success(`Comment sent to ${selectedStudentForComment.name}!`);
                                                        setSelectedStudentForComment(null);
                                                        setCommentText('');
                                                    }}
                                                    className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:grayscale"
                                                >
                                                    Send Comment <Send size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {view === 'reading' && activeMaterial && (
                    <div className="h-full flex flex-col p-2 animate-in fade-in duration-500">
                        <div className="flex items-center justify-between mb-2 px-2">
                            <button onClick={() => setView('stream')} className="flex items-center gap-2 text-primary font-bold hover:underline">
                                <ArrowLeft size={18} /> Back to Stream
                            </button>
                            <h3 className="text-xl font-black truncate max-w-xl">{activeMaterial.title} - Reference Material</h3>
                            <a href={activeMaterial.url} target="_blank" rel="noopener noreferrer" className="bg-primary text-primary-foreground px-6 py-2 rounded-xl font-bold shadow-lg shadow-primary/10">Download PDF</a>
                        </div>
                        <div className="flex-1 w-full bg-card border border-border rounded-xl overflow-hidden shadow-2xl flex flex-col">
                            <div className="bg-secondary p-3 flex items-center justify-between border-b border-border">
                                <span className="text-sm font-bold truncate max-w-xs">{activeMaterial.title}</span>
                                <div className="flex gap-2">
                                    <button className="p-2 hover:bg-background rounded-lg text-muted-foreground"><Share2 size={16} /></button>
                                    <button className="p-2 hover:bg-background rounded-lg text-muted-foreground"><MoreVertical size={16} /></button>
                                </div>
                            </div>
                            <div className="flex-1 w-full h-full bg-muted/30">
                                <iframe
                                    src={activeMaterial.url}
                                    className="w-full h-full"
                                    title="PDF Viewer"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {view === 'flashcards' && (
                    <div className="max-w-2xl mx-auto h-full flex flex-col items-center justify-center space-y-8 animate-in zoom-in-95 duration-500">
                        <button onClick={() => setView('classwork')} className="self-start flex items-center gap-2 text-primary font-bold hover:underline">
                            <ArrowLeft size={18} /> Back to Classwork
                        </button>
                        <div
                            className="w-full aspect-video perspective-1000 cursor-pointer group"
                            onClick={() => setIsFlipped(!isFlipped)}
                        >
                            <div className={`relative w-full h-full transition-transform duration-700 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                                {/* Front */}
                                <div className="absolute inset-0 bg-card border-2 border-primary/20 rounded-3xl p-12 flex flex-col items-center justify-center text-center backface-hidden shadow-2xl group-hover:border-primary transition-colors">
                                    <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6">
                                        <BrainCircuit size={32} />
                                    </div>
                                    <span className="text-primary text-xs font-black uppercase tracking-widest mb-4">Question</span>
                                    <h3 className="text-2xl font-bold">{topic.flashcards && topic.flashcards.length > 0 ? topic.flashcards[currentCardIndex].question : 'No flashcards available yet'}</h3>
                                    <p className="mt-8 text-muted-foreground text-sm uppercase font-bold tracking-tighter animate-bounce">Click to flip</p>
                                </div>
                                {/* Back */}
                                <div className="absolute inset-0 bg-primary text-primary-foreground rounded-3xl p-12 flex flex-col items-center justify-center text-center rotate-y-180 backface-hidden shadow-2xl shadow-primary/20">
                                    <span className="text-white/60 text-xs font-black uppercase tracking-widest mb-4">Answer</span>
                                    <p className="text-xl font-medium leading-relaxed">{topic.flashcards && topic.flashcards.length > 0 ? topic.flashcards[currentCardIndex].answer : 'Flashcards will be generated once PDF is indexed.'}</p>
                                </div>
                            </div>
                        </div>
                        {topic.flashcards && topic.flashcards.length > 0 && (
                            <div className="flex items-center gap-6">
                                <span className="text-sm font-bold text-muted-foreground">{currentCardIndex + 1} / {topic.flashcards.length}</span>
                                <button
                                    onClick={handleNextCard}
                                    className="bg-primary text-primary-foreground px-8 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                                >
                                    Next Card <ChevronRight size={20} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {view === 'assessment' && (
                    <div className="max-w-3xl mx-auto py-8 animate-in slide-in-from-right-4 duration-500">
                        <button onClick={() => setView('stream')} className="mb-6 flex items-center gap-2 text-primary font-bold hover:underline">
                            <ArrowLeft size={18} /> Back to Stream
                        </button>
                        {assessmentScore !== null ? (
                            <div className="bg-card border-2 border-border rounded-3xl p-12 text-center space-y-6 shadow-2xl">
                                <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center ${assessmentScore >= 80 ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                                    <CheckCircle2 size={48} />
                                </div>
                                <h3 className="text-3xl font-black">Assessment Complete!</h3>
                                <p className="text-6xl font-black text-primary">{assessmentScore}%</p>
                                <p className="text-muted-foreground">Great job! Your performance has been recorded.</p>
                                <button
                                    onClick={() => { setAssessmentScore(null); setAssessmentStep(0); }}
                                    className="bg-primary text-primary-foreground px-8 py-3 rounded-2xl font-bold hover:bg-primary/90"
                                >
                                    Retake Assessment
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-2xl font-black">Daily Quiz: {topic.title}</h3>
                                    <span className="px-3 py-1 bg-secondary rounded-full text-xs font-bold text-muted-foreground">Question {assessmentStep + 1} of {topic.questions?.length || 0}</span>
                                </div>
                                <div className="p-8 bg-card border border-border rounded-3xl shadow-sm">
                                    <p className="text-xl font-bold mb-8">
                                        {topic.questions && topic.questions.length > 0
                                            ? topic.questions[assessmentStep].question
                                            : "Questions are being generated from your document..."}
                                    </p>
                                    <div className="grid grid-cols-1 gap-3">
                                        {topic.questions && topic.questions[assessmentStep]?.options.map((option: string, i: number) => (
                                            <button
                                                key={i}
                                                className="w-full p-4 text-left bg-secondary hover:bg-primary/10 hover:border-primary border border-transparent rounded-2xl transition-all font-medium flex items-center justify-between group"
                                            >
                                                {option}
                                                <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30 group-hover:border-primary"></div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {topic.questions && topic.questions.length > 0 && (
                                    <div className="flex justify-end">
                                        <button
                                            onClick={() => {
                                                if (assessmentStep < topic.questions.length - 1) setAssessmentStep(prev => prev + 1);
                                                else handleAssessmentFinish();
                                            }}
                                            className="bg-primary text-primary-foreground px-10 py-4 rounded-2xl font-black shadow-xl shadow-primary/20 hover:scale-105 transition-all text-lg"
                                        >
                                            {assessmentStep === topic.questions.length - 1 ? 'Finish Assessment' : 'Next Question'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
};
