import React, { useState } from 'react';
import { X, Hash, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface JoinClassModalProps {
    isOpen: boolean;
    onClose: () => void;
    onJoin: (code: string) => Promise<boolean>;
}

export const JoinClassModal: React.FC<JoinClassModalProps> = ({
    isOpen,
    onClose,
    onJoin
}) => {
    const [joinCode, setJoinCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (joinCode.length !== 5) {
            toast.error('Please enter a valid 5-digit code');
            return;
        }

        setIsSubmitting(true);
        const success = await onJoin(joinCode);
        setIsSubmitting(false);
        if (success) {
            toast.success("Successfully joined the class!");
            setJoinCode('');
            onClose();
        } else {
            toast.error("Invalid enrollment code. Please check and try again.");
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-card border border-border w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 space-y-8 animate-in zoom-in-95 duration-300">
                <header className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-black">Join New Class</h2>
                        <p className="text-sm text-muted-foreground">Enter the enrollment code from your teacher.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-full transition-colors"
                    >
                        <X size={24} />
                    </button>
                </header>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Class Code</label>
                        <div className="relative">
                            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                            <input
                                type="text"
                                placeholder="E.g. AB123"
                                className="w-full pl-12 pr-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary transition-all font-black uppercase tracking-widest text-xl text-center"
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                maxLength={5}
                                autoFocus
                            />
                        </div>
                    </div>
                </div>

                <footer className="pt-4">
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || joinCode.length !== 5}
                        className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 transition-all flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? 'Verifying Code...' : 'Enroll Now'}
                        {!isSubmitting && <ArrowRight size={18} />}
                    </button>
                </footer>
            </div>
        </div>
    );
};
