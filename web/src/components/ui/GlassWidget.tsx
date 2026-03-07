import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, GripHorizontal } from "lucide-react";
import { useHUD } from "@/components/providers/HUDProvider";
import { motion, useDragControls } from "framer-motion";
import { loadWidgetLayout, saveWidgetLayout } from "@/lib/hud/widget-layout";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

interface GlassWidgetProps {
    id: string;
    visible?: boolean;
    title: string;
    children: React.ReactNode;
    initialWidth?: number;
    initialHeight?: number;
    defaultPosition?: { x: number; y: number };
    orderIndex?: number;
    constraintsRef?: React.RefObject<HTMLElement | null>;
}

function resolveInitialLayout(
    id: string,
    defaultPosition: { x: number; y: number },
    initialWidth: number,
    initialHeight: number,
): { position: { x: number; y: number }; size: { w: number; h: number } } {
    const fallback = {
        position: defaultPosition,
        size: { w: initialWidth, h: initialHeight },
    };

    if (typeof window === "undefined") {
        return fallback;
    }

    const saved = loadWidgetLayout(id);
    if (!saved) {
        return fallback;
    }

    const vw = window.innerWidth - 80;
    const vh = window.innerHeight;
    const w = Math.min(saved.w, vw - 24);
    const h = Math.min(saved.h, vh - 80);
    const x = Math.max(0, Math.min(saved.x, vw - w));
    const y = Math.max(52, Math.min(saved.y, vh - 60));
    return {
        position: { x, y },
        size: { w, h },
    };
}

export function GlassWidget({
    id,
    visible = true,
    title,
    children,
    initialWidth = 600,
    initialHeight = 600,
    defaultPosition = { x: 0, y: 0 },
    orderIndex = 0,
    constraintsRef,
}: GlassWidgetProps) {
    const { closeWidget, focusedWidget, focusWidget } = useHUD();
    const isFocused = visible && focusedWidget === id;
    const dragControls = useDragControls();

    const [initialPos, setInitialPos] = useState(defaultPosition);
    const [size, setSize] = useState({ w: initialWidth, h: initialHeight });
    const cumulativeOffset = useRef({ x: 0, y: 0 });
    const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const persisted = resolveInitialLayout(id, defaultPosition, initialWidth, initialHeight);
            setInitialPos(persisted.position);
            setSize(persisted.size);
            cumulativeOffset.current = { x: 0, y: 0 };
        }, 0);
        return () => window.clearTimeout(timer);
    }, [id, defaultPosition, initialWidth, initialHeight]);

    const handleDragEnd = useCallback(
        (_: unknown, info: { offset: { x: number; y: number } }) => {
            cumulativeOffset.current.x += info.offset.x;
            cumulativeOffset.current.y += info.offset.y;
            saveWidgetLayout(id, {
                x: initialPos.x + cumulativeOffset.current.x,
                y: initialPos.y + cumulativeOffset.current.y,
                w: size.w,
                h: size.h,
            });
        },
        [id, initialPos.x, initialPos.y, size.w, size.h],
    );

    const onResizePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            focusWidget(id);
            const target = e.currentTarget as HTMLElement;
            target.setPointerCapture(e.pointerId);
            resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h };
        },
        [size.w, size.h, focusWidget, id],
    );

    const onResizePointerMove = useCallback((e: React.PointerEvent) => {
        if (!resizeRef.current) return;
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        setSize({
            w: Math.max(MIN_WIDTH, resizeRef.current.startW + dx),
            h: Math.max(MIN_HEIGHT, resizeRef.current.startH + dy),
        });
    }, []);

    const onResizePointerUp = useCallback(() => {
        if (!resizeRef.current) return;
        resizeRef.current = null;
        const pos = {
            x: initialPos.x + cumulativeOffset.current.x,
            y: initialPos.y + cumulativeOffset.current.y,
        };
        setSize((s) => {
            saveWidgetLayout(id, { ...pos, w: s.w, h: s.h });
            return s;
        });
    }, [id, initialPos.x, initialPos.y]);

    return (
        <motion.div
            data-testid={`glass-widget-${id}`}
            drag={visible}
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragElastic={0}
            dragConstraints={constraintsRef}
            onDragEnd={handleDragEnd}
            whileDrag={{ scale: 1.01, cursor: "grabbing" }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{
                opacity: isFocused ? 1 : 0.85,
                scale: 1,
                filter: isFocused ? "blur(0px) brightness(1)" : "blur(0px) brightness(0.85)",
                zIndex: isFocused ? 50 : 10 + orderIndex,
            }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onPointerDownCapture={() => {
                if (!visible) return;
                focusWidget(id);
            }}
            style={{
                left: initialPos.x,
                top: initialPos.y,
                width: size.w,
                height: size.h,
                display: visible ? undefined : "none",
            }}
            className={`absolute flex flex-col rounded-xl
      bg-black/20 backdrop-blur-md border border-cyan-500/30 overflow-hidden pointer-events-auto
      ${isFocused ? "shadow-[0_0_50px_rgba(0,255,255,0.15)] ring-1 ring-cyan-500/50" : "shadow-none"}
      `}
        >
            <div
                className="h-10 flex items-center justify-between px-4 border-b border-white/10 bg-black/40 shrink-0 cursor-grab active:cursor-grabbing group"
                onPointerDown={(event) => {
                    focusWidget(id);
                    dragControls.start(event);
                }}
            >
                <div className="flex items-center gap-2">
                    <GripHorizontal size={14} className="text-white/20 group-hover:text-white/50 transition-colors" />
                    <h3
                        data-testid={`glass-widget-title-${id}`}
                        className={`font-mono text-[10px] font-bold tracking-widest transition-colors ${isFocused ? "text-cyan-400" : "text-white/40"}`}
                    >
                        {title}
                    </h3>
                </div>
                <button
                    data-testid={`glass-widget-close-${id}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        closeWidget(id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    aria-label={`Close ${title}`}
                    className="text-white/40 hover:text-white hover:bg-white/10 p-1 rounded transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            <div
                className={`flex-1 relative ${id === "settings" || id === "model_control" || id === "ideation" ? "overflow-y-auto" : "overflow-hidden"}`}
                onPointerDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>

            <div
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-10 group/resize"
            >
                <svg
                    viewBox="0 0 16 16"
                    className="w-3 h-3 absolute bottom-1 right-1 text-white/20 group-hover/resize:text-cyan-400/60 transition-colors"
                >
                    <path d="M14 14L8 14M14 14L14 8M14 14L4 14M14 14L14 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
            </div>
        </motion.div>
    );
}
