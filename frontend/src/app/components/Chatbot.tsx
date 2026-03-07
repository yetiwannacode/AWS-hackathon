import React, { useState, useRef, useEffect } from 'react';
import {
    MessageCircle,
    X,
    Send,
    Bot,
    User
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current) {
            mermaid.render(`mermaid-${Math.random().toString(36).substr(2, 9)}`, chart).then((result) => {
                if (ref.current) ref.current.innerHTML = result.svg;
            }).catch((err) => {
                console.error("Mermaid failed to render", err);
                if (ref.current) ref.current.innerHTML = `<p class="text-red-500 text-xs">Failed to render chart</p>`;
            });
        }
    }, [chart]);

    return <div ref={ref} className="my-4 flex justify-center bg-white/5 p-4 rounded-lg overflow-x-auto" />;
};

interface ChatbotProps {
    sessionId: string | null;
    track?: 'institution' | 'individual';
    classrooms?: { id: string; title: string }[];
}

export const Chatbot: React.FC<ChatbotProps> = ({ sessionId, track = 'institution', classrooms = [] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [language, setLanguage] = useState<'english' | 'hindi' | 'telugu' | null>(null);
    const [selectedClassroom, setSelectedClassroom] = useState<string | null>(null);
    const [messages, setMessages] = useState([
        { id: '1', role: 'assistant', content: 'Hi! I\'m your Study Assistant Bot. Please select your preferred language to begin!' }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-select classroom if sessionId is provided
    useEffect(() => {
        if (sessionId) {
            setSelectedClassroom(sessionId);
        }
    }, [sessionId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    const handleLanguageSelect = (lang: 'english' | 'hindi' | 'telugu') => {
        setLanguage(lang);
        const welcomeMsg = {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Great! You've selected **${lang.charAt(0).toUpperCase() + lang.slice(1)}**. I will now help you with your doubts in a mix of ${lang} and English. Ask me anything!`
        };
        setMessages(prev => [...prev, welcomeMsg]);
    };

    const handleClassroomSelect = (classroomId: string) => {
        setSelectedClassroom(classroomId);
        const classroomName = classrooms.find((cls) => cls.id === classroomId)?.title || classroomId;
        const classroomMsg = {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Perfect! I'm now connected to the **${classroomName}** classroom. What would you like to know?`
        };
        setMessages(prev => [...prev, classroomMsg]);
    };

    const handleSend = async () => {
        if (!input.trim() || !language || !selectedClassroom) return;

        const userMsg = { id: Date.now().toString(), role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        console.log("🤖 Chatbot Request:", { selectedClassroom, input, language });

        try {
            const activeSessionId = selectedClassroom;
            const url = `${API_BASE_URL}/ask?session_id=${encodeURIComponent(activeSessionId)}&query=${encodeURIComponent(input)}&language=${language}&track=${track}`;
            console.log("🔗 Fetching URL:", url);
            const response = await fetch(url, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error('Failed to get response from assistant');
            }

            const data = await response.json();

            const botMsg = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.response
            };
            setMessages(prev => [...prev, botMsg]);
            setIsTyping(false);

        } catch (error: any) {
            console.error('Chat error:', error);
            const errorMsg = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "I'm sorry, I'm having trouble connecting to the brain right now. Please make sure the backend is running!"
            };
            setMessages(prev => [...prev, errorMsg]);
            setIsTyping(false);
        }
    };

    return (
        <>
            <div className={`fixed bottom-8 right-8 z-50 flex items-center justify-center transition-all duration-500 ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}>
                <div className="absolute w-20 h-20 bg-primary/10 rounded-full animate-pulse" />
                <button
                    onClick={() => setIsOpen(true)}
                    className="w-16 h-16 bg-white/10 backdrop-blur-xl border border-white/20 text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 hover:bg-white/20 transition-all relative z-10 group"
                >
                    <MessageCircle size={32} className="group-hover:rotate-12 transition-transform" />
                </button>
            </div>

            <div
                className={`fixed bottom-6 right-6 w-[400px] h-[600px] bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 z-50 origin-bottom-right ${isOpen ? 'scale-100 opacity-100' : 'scale-50 opacity-0 pointer-events-none'}`}
            >
                <header className="px-6 py-4 bg-primary text-primary-foreground flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                            <Bot size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold leading-tight">Doubt Assistant</h3>
                            <p className="text-[10px] opacity-70 uppercase tracking-widest font-black">Online Now</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </header>

                <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-6 bg-transparent">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${msg.role === 'assistant' ? 'bg-primary text-primary-foreground' : 'bg-secondary border border-border'}`}>
                                {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
                            </div>
                            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'assistant' ? 'bg-white/10 border border-white/10 rounded-tl-none font-medium' : 'bg-primary text-primary-foreground rounded-tr-none font-semibold'}`}>
                                {msg.role === 'assistant' ? (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            code({ node, inline, className, children, ...props }: any) {
                                                const match = /language-(\w+)/.exec(className || '');
                                                const isMermaid = match && match[1] === 'mermaid';

                                                if (!inline && isMermaid) {
                                                    return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                                                }

                                                return !inline && match ? (
                                                    <div className="my-2 rounded-lg overflow-hidden bg-black/30 border border-white/10">
                                                        <div className="bg-white/5 px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase">{match[1]}</div>
                                                        <code className={`${className} block p-3 overflow-x-auto`} {...props}>
                                                            {children}
                                                        </code>
                                                    </div>
                                                ) : (
                                                    <code className={`${className} bg-black/20 px-1 py-0.5 rounded font-mono text-[11px]`} {...props}>
                                                        {children}
                                                    </code>
                                                );
                                            },
                                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                                            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                                            li: ({ children }) => <li className="pl-1">{children}</li>,
                                            a: ({ children, href }) => <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                            strong: ({ children }) => <strong className="font-bold text-white/90">{children}</strong>,
                                            h1: ({ children }) => <h1 className="text-lg font-bold my-2">{children}</h1>,
                                            h2: ({ children }) => <h2 className="text-base font-bold my-2">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-sm font-bold my-1">{children}</h3>,
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                ) : (
                                    msg.content
                                )}
                            </div>
                        </div>
                    ))}

                    {!language && (
                        <div className="flex flex-col gap-2 p-4 bg-white/5 rounded-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-300">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Select Language</p>
                            <div className="grid grid-cols-3 gap-2">
                                {(['english', 'hindi', 'telugu'] as const).map((lang) => (
                                    <button
                                        key={lang}
                                        onClick={() => handleLanguageSelect(lang)}
                                        className="py-2.5 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/20 rounded-xl text-xs font-black uppercase tracking-tighter transition-all"
                                    >
                                        {lang}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {language && !selectedClassroom && !sessionId && (
                        <div className="flex flex-col gap-2 p-4 bg-white/5 rounded-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-300">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Select Classroom</p>
                            {classrooms.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-2">No classrooms found. Upload materials first!</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {classrooms.map((classroom) => (
                                        <button
                                            key={classroom.id}
                                            onClick={() => handleClassroomSelect(classroom.id)}
                                            className="py-2.5 px-4 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/20 rounded-xl text-sm font-bold transition-all text-left"
                                        >
                                            {classroom.title}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {isTyping && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                                <Bot size={16} />
                            </div>
                            <div className="bg-white/10 border border-white/10 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce"></div>
                                <div className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                                <div className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-transparent">
                    <div className={`flex items-center gap-2 bg-white/5 p-2 rounded-2xl border border-white/10 px-4 transition-all focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary ${!language || !selectedClassroom ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <input
                            type="text"
                            value={input}
                            disabled={!language || !selectedClassroom}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={!language ? "Select language first..." : !selectedClassroom ? "Select classroom first..." : "Ask a doubt..."}
                            className="flex-1 bg-transparent border-none focus:outline-none text-sm font-medium py-2 disabled:cursor-not-allowed"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || !language || !selectedClassroom}
                            className="p-2 bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                    <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium">Powered by Study Assistant AI</p>
                </div>
            </div>
        </>
    );
};
