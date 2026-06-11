"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type User = {
  id: number;
  email: string;
  password: string;
  display_name: string;
  role: "admin" | "member";
  avatar_url?: string | null;
  is_active?: boolean;
};

type CustomEmoji = {
  id: number;
  name: string;
  image_url: string;
  created_at?: string;
};

type MessageReaction = {
  id: number;
  message_id: number;
  user_id: number;
  emoji_name: string;
  users?: User;
};

type Message = {
  id: number;
  user_id: number;
  content: string;
  created_at: string;
  read_by?: number[] | null;
  media_url?: string | null;
  media_type?: string | null;
  media_name?: string | null;
  room_type?: "group" | "dm";
  recipient_id?: number | null;
  reply_to_id?: number | null;
  users?: User;
};

const PAGE_SIZE = 50;

function isActuallyOnline(user: User, onlineIds: number[]) {
  return onlineIds.includes(user.id);
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function renderTextWithLinksAndEmojis(
  text: string,
  customEmojis: CustomEmoji[]
) {
  const tokenRegex = /(https?:\/\/[^\s]+|:[a-zA-Z0-9_가-힣-]+:)/g;

  return text.split(tokenRegex).map((part, index) => {
    if (part.match(/^https?:\/\/[^\s]+$/)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium break-all"
        >
          {part}
        </a>
      );
    }

    const emojiMatch = part.match(/^:([a-zA-Z0-9_가-힣-]+):$/);
    if (emojiMatch) {
      const emoji = customEmojis.find((e) => e.name === emojiMatch[1]);
      if (emoji) {
        return (
          <img
            key={index}
            src={emoji.image_url}
            alt={part}
            title={part}
            className="mx-1 inline-block h-7 w-7 rounded object-contain align-[-6px]"
          />
        );
      }
    }

    return <span key={index}>{part}</span>;
  });
}

export default function Home() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allMessagesForBadges, setAllMessagesForBadges] = useState<Message[]>(
    []
  );
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [messageReactions, setMessageReactions] = useState<MessageReaction[]>(
    []
  );
  const [onlineIds, setOnlineIds] = useState<number[]>([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");

  const [opacity, setOpacity] = useState(100);
  const [adminOpen, setAdminOpen] = useState(false);
  const [bossMode, setBossMode] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [sending, setSending] = useState(false);
  const [notificationOn, setNotificationOn] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<"group" | number>("group");

  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [openReactionPickerFor, setOpenReactionPickerFor] = useState<number | null>(
    null
  );

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");

  const [newEmojiName, setNewEmojiName] = useState("");
  const [newEmojiFile, setNewEmojiFile] = useState<File | null>(null);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [showEmojiSuggest, setShowEmojiSuggest] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const firstUnreadRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const notificationOnRef = useRef(notificationOn);

  const isAdmin = me?.role === "admin";

  const activeUsers = useMemo(
    () => users.filter((u) => u.is_active !== false),
    [users]
  );

  const onlineUsers = useMemo(
    () => activeUsers.filter((u) => isActuallyOnline(u, onlineIds)),
    [activeUsers, onlineIds]
  );

  const userMap = useMemo(() => {
    return new Map(users.map((u) => [u.id, u]));
  }, [users]);

  const messageMap = useMemo(() => {
    return new Map(messages.map((m) => [m.id, m]));
  }, [messages]);

  const reactionsByMessageId = useMemo(() => {
    const map = new Map<number, MessageReaction[]>();

    for (const reaction of messageReactions) {
      const current = map.get(reaction.message_id) ?? [];
      current.push(reaction);
      map.set(reaction.message_id, current);
    }

    return map;
  }, [messageReactions]);

  const currentRoomMemberCount =
    selectedRoom === "group" ? activeUsers.length : 2;

  const firstUnreadId = useMemo(() => {
    if (!me) return null;

    const firstUnread = messages.find((m) => {
      const readBy = m.read_by ?? [];
      return m.user_id !== me.id && !readBy.includes(me.id);
    });

    return firstUnread?.id ?? null;
  }, [messages, me?.id]);

  useEffect(() => {
    const saved = localStorage.getItem("work-log-user");
    if (saved) setMe(JSON.parse(saved));

    const savedOpacity = localStorage.getItem("work-log-opacity");
    if (savedOpacity) setOpacity(Number(savedOpacity));

    const savedNotification = localStorage.getItem("work-log-notification-on");
    if (savedNotification !== null) {
      setNotificationOn(savedNotification === "true");
    }

    loadUsers();
    loadAllMessagesForBadges();
    loadCustomEmojis();
    loadMessageReactions();
  }, []);

  useEffect(() => {
    notificationOnRef.current = notificationOn;
  }, [notificationOn]);

  useEffect(() => {
    loadMessages(false);
    loadAllMessagesForBadges();
    loadCustomEmojis();
    loadMessageReactions();

    const messagesChannel = supabase
      .channel("messages-channel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const newMessage = payload.new as Message;

          const belongsToCurrentRoom =
            selectedRoom === "group"
              ? newMessage.room_type === "group"
              : newMessage.room_type === "dm" &&
                me &&
                ((newMessage.user_id === me.id &&
                  newMessage.recipient_id === selectedRoom) ||
                  (newMessage.user_id === selectedRoom &&
                    newMessage.recipient_id === me.id));

          await loadAllMessagesForBadges();

          if (!belongsToCurrentRoom) {
            if (me && newMessage.user_id !== me.id) showNotification(newMessage);
            return;
          }

          await loadMessages(false);

          const isMine = me && newMessage.user_id === me.id;

          if (!isMine) showNotification(newMessage);

          if (isNearBottomRef.current || isMine) {
            setTimeout(scrollToBottom, 80);
          } else {
            setShowScrollButton(true);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        async () => {
          await loadMessages(false);
          await loadAllMessagesForBadges();
        }
      )
      .subscribe();

    const reactionsChannel = supabase
      .channel("message-reactions-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        async () => {
          await loadMessageReactions();
        }
      )
      .subscribe();

    const emojiChannel = supabase
      .channel("custom-emojis-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_emojis" },
        async () => {
          await loadCustomEmojis();
        }
      )
      .subscribe();

    const usersChannel = supabase
      .channel("users-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "users" },
        async () => {
          await loadUsers();
          await loadMessages(false);
          await loadAllMessagesForBadges();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(reactionsChannel);
      supabase.removeChannel(emojiChannel);
      supabase.removeChannel(usersChannel);
    };
  }, [me?.id, selectedRoom]);

  useEffect(() => {
    if (!me?.id) return;

    const channel = supabase.channel("online-users", {
      config: {
        presence: {
          key: String(me.id),
        },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const ids = Object.keys(state).map((id) => Number(id));
        setOnlineIds(ids);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: me.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [me?.id]);

  useEffect(() => {
    localStorage.setItem("work-log-opacity", String(opacity));
  }, [opacity]);

  useEffect(() => {
    localStorage.setItem("work-log-notification-on", String(notificationOn));
  }, [notificationOn]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
        setBossMode((v) => !v);
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "o") {
        setOpacity(100);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      alert("이 브라우저는 알림을 지원하지 않아.");
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === "granted";
  }

  async function toggleNotification() {
    if (notificationOn) {
      setNotificationOn(false);
      return;
    }

    const ok = await requestNotificationPermission();
    if (ok) setNotificationOn(true);
  }

  function showNotification(message: Message) {
    if (!notificationOnRef.current) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const sender = userMap.get(message.user_id) ?? message.users;

    new Notification(sender?.display_name ?? "새 메시지", {
      body: message.content || message.media_name || "미디어를 보냈어.",
      icon: sender?.avatar_url || "/default-avatar.png",
    });
  }

  function getUnreadCount(room: "group" | number) {
    if (!me) return 0;

    return allMessagesForBadges.filter((m) => {
      const readBy = m.read_by ?? [];

      if (m.user_id === me.id) return false;
      if (readBy.includes(me.id)) return false;

      if (room === "group") {
        return m.room_type === "group";
      }

      return (
        m.room_type === "dm" &&
        ((m.user_id === me.id && m.recipient_id === room) ||
          (m.user_id === room && m.recipient_id === me.id))
      );
    }).length;
  }

  function scrollToBottom() {
    const el = chatScrollRef.current;

    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setShowScrollButton(false);
    });
  }

  function scrollAfterMessagesLoaded(loadedMessages: Message[]) {
    if (!me) {
      setTimeout(scrollToBottom, 120);
      return;
    }

    const firstUnread = loadedMessages.find((m) => {
      const readBy = m.read_by ?? [];
      return m.user_id !== me.id && !readBy.includes(me.id);
    });

    setTimeout(() => {
      if (firstUnread) {
        const el = document.getElementById(`message-${firstUnread.id}`);

        if (el) {
          el.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });

          isNearBottomRef.current = false;
          setShowScrollButton(true);
          return;
        }
      }

      scrollToBottom();
    }, 200);
  }

  function scrollToMessage(messageId: number) {
    const el = document.getElementById(`message-${messageId}`);

    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      el.classList.add("ring-2", "ring-indigo-300", "rounded-2xl");

      setTimeout(() => {
        el.classList.remove("ring-2", "ring-indigo-300", "rounded-2xl");
      }, 1200);
    }
  }

  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    isNearBottomRef.current = isNearBottom;
    setShowScrollButton(!isNearBottom);

    if (el.scrollTop < 80 && hasMoreMessages && !loadingMore) {
      loadMessages(true);
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files: File[] = [];

    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...files]);
    }
  }

  async function loadUsers() {
    const { data } = await supabase
      .from("users")
      .select("*")
      .order("id", { ascending: true });

    setUsers(data ?? []);
  }

  async function loadAllMessagesForBadges() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    setAllMessagesForBadges(data ?? []);
  }

  async function loadCustomEmojis() {
    const { data } = await supabase
      .from("custom_emojis")
      .select("*")
      .order("name", { ascending: true });

    setCustomEmojis(data ?? []);
  }

  async function loadMessageReactions() {
    const { data } = await supabase
      .from("message_reactions")
      .select("*, users(*)")
      .order("created_at", { ascending: true });

    setMessageReactions(data ?? []);
  }

  async function addCustomEmoji() {
    if (!isAdmin) return;

    const cleanName = newEmojiName
      .trim()
      .replaceAll(":", "")
      .replace(/\s+/g, "_");

    if (!cleanName || !newEmojiFile) {
      alert("이모티콘 이름과 이미지를 모두 넣어줘.");
      return;
    }

    const fileExt = newEmojiFile.name.split(".").pop()?.toLowerCase() || "png";
    const filePath = `${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("custom-emojis")
      .upload(filePath, newEmojiFile, { upsert: true });

    if (uploadError) {
      alert("이모티콘 업로드 실패: " + uploadError.message);
      return;
    }

    const { data } = supabase.storage
      .from("custom-emojis")
      .getPublicUrl(filePath);

    const { error } = await supabase.from("custom_emojis").upsert(
      {
        name: cleanName,
        image_url: `${data.publicUrl}?t=${Date.now()}`,
      },
      { onConflict: "name" }
    );

    if (error) {
      alert("이모티콘 등록 실패: " + error.message);
      return;
    }

    setNewEmojiName("");
    setNewEmojiFile(null);
    await loadCustomEmojis();
  }

  async function deleteCustomEmoji(emoji: CustomEmoji) {
    if (!isAdmin) return;

    const ok = confirm(`:${emoji.name}: 이모티콘을 삭제할까?`);
    if (!ok) return;

    const { error } = await supabase
      .from("custom_emojis")
      .delete()
      .eq("id", emoji.id);

    if (error) {
      alert("이모티콘 삭제 실패: " + error.message);
      return;
    }

    await loadCustomEmojis();
  }

  function insertEmoji(name: string) {
    const token = `:${name}:`;

    if (emojiQuery) {
      setContent((prev) => prev.replace(new RegExp(`:${emojiQuery}$`), token));
    } else {
      setContent((prev) => `${prev}${token}`);
    }

    setEmojiQuery("");
    setShowEmojiSuggest(false);
  }

  async function toggleReaction(messageId: number, emojiName: string) {
    if (!me) return;

    const existing = messageReactions.find(
      (r) =>
        r.message_id === messageId &&
        r.user_id === me.id &&
        r.emoji_name === emojiName
    );

    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("message_reactions").insert({
        message_id: messageId,
        user_id: me.id,
        emoji_name: emojiName,
      });
    }

    await loadMessageReactions();
  }

  function renderReactions(messageId: number) {
    const reactions = reactionsByMessageId.get(messageId) ?? [];
    if (reactions.length === 0) return null;

    const grouped = reactions.reduce<Record<string, MessageReaction[]>>(
      (acc, reaction) => {
        acc[reaction.emoji_name] = acc[reaction.emoji_name] ?? [];
        acc[reaction.emoji_name].push(reaction);
        return acc;
      },
      {}
    );

    return (
      <div className="flex w-fit max-w-full flex-wrap items-center gap-1">
        {Object.entries(grouped).map(([emojiName, list]) => {
          const emoji = customEmojis.find((e) => e.name === emojiName);
          const mineReacted = !!me && list.some((r) => r.user_id === me.id);

          return (
            <button
              key={emojiName}
              type="button"
              onClick={() => toggleReaction(messageId, emojiName)}
              className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs shadow-sm ${
                mineReacted
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50"
              }`}
              title={`:${emojiName}:`}
            >
              {emoji ? (
                <img
                  src={emoji.image_url}
                  alt={`:${emojiName}:`}
                  className="h-5 w-5 rounded object-contain"
                />
              ) : (
                <span>:{emojiName}:</span>
              )}
              <span className="font-semibold">{list.length}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderReactionPicker(message: Message) {
    if (customEmojis.length === 0) return null;

    return (
      <div className="relative hidden items-center gap-1 group-hover:flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenReactionPickerFor((current) =>
              current === message.id ? null : message.id
            );
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm shadow-sm hover:bg-indigo-50"
          title="반응 추가"
        >
          ☺+
        </button>

        {openReactionPickerFor === message.id && (
          <div className="absolute bottom-8 left-0 z-50 flex max-w-[240px] flex-wrap gap-1 rounded-2xl border border-indigo-100 bg-white p-2 shadow-xl">
            {customEmojis.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReaction(message.id, emoji.name);
                  setOpenReactionPickerFor(null);
                }}
                title={`:${emoji.name}:`}
                className="rounded-lg p-1 hover:bg-indigo-50"
              >
                <img
                  src={emoji.image_url}
                  alt={emoji.name}
                  className="h-6 w-6 rounded object-contain"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderReplyPreview(message: Message, mine: boolean) {
    if (!message.reply_to_id) return null;

    const replyMessage =
      messageMap.get(message.reply_to_id) ??
      allMessagesForBadges.find((m) => m.id === message.reply_to_id);

    if (!replyMessage) {
      return (
        <div
          className={`mb-2 rounded-xl px-3 py-2 text-xs border-l-4 ${
            mine
              ? "bg-white/20 border-white/70 text-white"
              : "bg-white border-indigo-400 text-slate-600"
          }`}
        >
          원본 메시지를 불러올 수 없음
        </div>
      );
    }

    return (
      <button
        onClick={() => scrollToMessage(replyMessage.id)}
        className={`mb-2 w-full text-left rounded-xl px-3 py-2 text-xs border-l-4 ${
          mine
            ? "bg-white/20 border-white/70 text-white"
            : "bg-white border-indigo-400 text-slate-600"
        }`}
      >
        <div className="font-semibold mb-1">
          {userMap.get(replyMessage.user_id)?.display_name ?? "답장"}
        </div>
        <div className="max-h-10 overflow-hidden opacity-80">
          {replyMessage.content || replyMessage.media_name || "미디어"}
        </div>
      </button>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50 flex items-center justify-center">
        <div className="bg-white/90 backdrop-blur border border-indigo-100 rounded-3xl p-8 w-[390px] shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold mb-5">
            WL
          </div>

          <h1 className="text-2xl font-bold mb-2 text-slate-900">
            업무 로그 시스템
          </h1>
          <p className="text-sm text-slate-500 mb-7">
            지정된 계정으로 입장해 주세요.
          </p>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 mb-3 outline-none focus:ring-2 focus:ring-indigo-200"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            type="password"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-indigo-200"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                login();
              }
            }}
          />

          <button
            onClick={login}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3 font-medium transition"
          >
            입장
          </button>
        </div>
      </main>
    );
  }

  if (bossMode) {
    return (
      <main className="min-h-screen bg-indigo-50 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                2026 Q3 마케팅 업무 현황
              </h1>
              <p className="text-sm text-slate-500">
                Ctrl + Shift + B로 원래 화면으로 돌아가기
              </p>
            </div>
            <button
              onClick={() => setBossMode(false)}
              className="bg-white border border-indigo-100 px-4 py-2 rounded-xl shadow-sm"
            >
              업무 로그 보기
            </button>
          </header>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-slate-500">전체 담당자</p>
              <p className="text-3xl font-bold text-indigo-600">
                {activeUsers.length}
              </p>
            </div>
            <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-slate-500">접속 중</p>
              <p className="text-3xl font-bold text-emerald-500">
                {onlineUsers.length}
              </p>
            </div>
            <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-slate-500">현재 방 기록</p>
              <p className="text-3xl font-bold text-violet-600">
                {messages.length}
              </p>
            </div>
          </div>

          <div className="bg-white border border-indigo-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-indigo-50 border-b border-indigo-100">
                <tr>
                  <th className="text-left p-4">담당자</th>
                  <th className="text-left p-4">상태</th>
                  <th className="text-left p-4">진행 상태</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-b-0">
                    <td className="p-4 flex items-center gap-3">
                      <img
                        src={u.avatar_url || "/default-avatar.png"}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover bg-slate-200"
                      />
                      {u.display_name}
                    </td>
                    <td className="p-4">
                      {isActuallyOnline(u, onlineIds) ? "진행 중" : "대기"}
                    </td>
                    <td className="p-4">
                      <span className="bg-indigo-50 text-indigo-700 rounded-full px-3 py-1">
                        검수/수정 확인
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-2 sm:p-6 overflow-hidden">
      <div
        style={{ opacity: opacity / 100 }}
        className="w-full max-w-6xl mx-auto h-[calc(100dvh-24px)] sm:h-[calc(100vh-48px)] bg-white/95 backdrop-blur border border-indigo-100 rounded-3xl shadow-xl overflow-hidden flex flex-col"
      >
        <header className="min-h-[76px] flex flex-col sm:flex-row gap-3 sm:gap-0 justify-between sm:items-center px-4 sm:px-6 py-3 sm:py-0 border-b border-indigo-100 bg-gradient-to-r from-white to-indigo-50 shrink-0">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">
              {selectedRoom === "group"
                ? "2026 Q3 마케팅 업무 로그"
                : `${
                    userMap.get(selectedRoom)?.display_name ?? "개인"
                  }님과의 개인 업무 로그`}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              {selectedRoom === "group"
                ? "전체방 / 광고 소재 / 검수 / 수정 요청 기록"
                : "개인 업무 대화"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3 items-center justify-end">
            <div className="text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-full">
              접속 중 {onlineUsers.length}명
            </div>

            <button
              onClick={toggleNotification}
              className={`text-sm border rounded-xl px-3 py-2 transition ${
                notificationOn
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white hover:bg-indigo-50 border-indigo-100"
              }`}
            >
              {notificationOn ? "알림 ON" : "알림 OFF"}
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>투명도 {opacity}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-20 sm:w-24"
              />
            </div>

            <label className="cursor-pointer">
              <img
                src={
                  (userMap.get(me.id)?.avatar_url ?? me.avatar_url) ||
                  "/default-avatar.png"
                }
                alt=""
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover bg-slate-200 border-2 border-white shadow"
                title="프로필 사진 변경"
              />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAvatar(file, me.id);
                }}
              />
            </label>

            {isAdmin && (
              <button
                onClick={() => setAdminOpen((v) => !v)}
                className="text-sm border border-indigo-100 bg-white hover:bg-indigo-50 rounded-xl px-3 py-2 transition"
              >
                관리자
              </button>
            )}

            <button
              onClick={() => setBossMode(true)}
              className="text-sm border border-indigo-100 bg-white hover:bg-indigo-50 rounded-xl px-3 py-2 transition"
            >
              업무 현황
            </button>

            <button
              onClick={logout}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              로그아웃
            </button>
          </div>
        </header>

        {adminOpen && isAdmin && (
          <section className="max-h-[280px] overflow-y-auto border-b border-indigo-100 bg-indigo-50/60 p-5 shrink-0">
            <h2 className="font-bold mb-4 text-slate-900">관리자 대시보드</h2>

            <div className="bg-white border border-indigo-100 rounded-2xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_100px] gap-3">
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="새 멤버 이메일"
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="비밀번호"
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="표시명"
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                onClick={addUser}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm transition py-2"
              >
                추가
              </button>
            </div>

            <div className="bg-white border border-indigo-100 rounded-2xl p-4 mb-4">
              <h3 className="font-semibold text-sm text-slate-900 mb-3">
                커스텀 이모티콘
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_100px] gap-3 mb-4">
                <input
                  value={newEmojiName}
                  onChange={(e) => setNewEmojiName(e.target.value)}
                  placeholder="이름 예: ok, bread, review"
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                />

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewEmojiFile(e.target.files?.[0] ?? null)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />

                <button
                  type="button"
                  onClick={addCustomEmoji}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm transition py-2"
                >
                  등록
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {customEmojis.length === 0 && (
                  <p className="text-xs text-slate-400">
                    아직 등록된 이모티콘이 없어.
                  </p>
                )}

                {customEmojis.map((emoji) => (
                  <div
                    key={emoji.id}
                    className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <img
                      src={emoji.image_url}
                      alt={emoji.name}
                      className="h-6 w-6 rounded object-contain"
                    />
                    <span className="text-xs">:{emoji.name}:</span>
                    <button
                      type="button"
                      onClick={() => deleteCustomEmoji(emoji)}
                      className="text-xs text-red-500"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className={`bg-white border border-indigo-100 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-[70px_1.4fr_1fr_1fr_90px_120px] gap-3 items-center ${
                    u.is_active === false ? "opacity-40" : ""
                  }`}
                >
                  <label className="relative cursor-pointer group w-12 h-12">
                    <img
                      src={u.avatar_url || "/default-avatar.png"}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover bg-slate-200"
                      title="프로필 사진 변경"
                    />

                    <span
                      className={`absolute right-1 bottom-1 w-3 h-3 rounded-full border-2 border-white ${
                        isActuallyOnline(u, onlineIds)
                          ? "bg-emerald-500"
                          : "bg-slate-300"
                      }`}
                    />

                    <div className="absolute inset-0 rounded-full bg-black/40 text-white text-[10px] hidden group-hover:flex items-center justify-center">
                      변경
                    </div>

                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAvatar(file, u.id);
                      }}
                    />
                  </label>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">이메일</p>
                    <p className="text-sm">{u.email}</p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">표시명</p>
                    <input
                      defaultValue={u.display_name}
                      onBlur={(e) => updateDisplayName(u.id, e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-2 w-full text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">비밀번호</p>
                    <input
                      defaultValue={u.password}
                      onBlur={(e) => updatePassword(u.id, e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-2 w-full text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">상태</p>
                    <p className="text-sm">
                      {u.is_active === false
                        ? "비활성"
                        : isActuallyOnline(u, onlineIds)
                        ? "접속 중"
                        : "오프라인"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleActive(u)}
                      className="border rounded-lg px-2 py-2 text-xs"
                    >
                      {u.is_active === false ? "활성" : "비활성"}
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      className="border rounded-lg px-2 py-2 text-xs text-red-500"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex-1 min-h-0 grid grid-rows-[auto_1fr] lg:grid-rows-none lg:grid-cols-[1fr_260px]">
          <div className="min-h-0 flex flex-col border-r border-indigo-100">
            <div className="relative flex-1 min-h-0">
              <div
                ref={chatScrollRef}
                onClick={markMessagesAsRead}
                onScroll={handleChatScroll}
                onPaste={handlePaste}
                className="h-full overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 bg-white"
              >
                {loadingMore && (
                  <div className="text-center text-xs text-slate-400">
                    이전 메시지 불러오는 중...
                  </div>
                )}

                {hasMoreMessages && !loadingMore && (
                  <div className="text-center text-xs text-slate-400">
                    위로 올리면 이전 메시지를 더 불러와요
                  </div>
                )}

                {messages.map((m) => {
                  const mine = m.user_id === me.id;
                  const readCount = m.read_by?.length ?? 0;
                  const writer = userMap.get(m.user_id) ?? m.users;

                  return (
                    <div
                      key={m.id}
                      id={`message-${m.id}`}
                      ref={m.id === firstUnreadId ? firstUnreadRef : null}
                      className="group"
                    >
                      {m.id === firstUnreadId && (
                        <div className="text-center text-xs text-indigo-600 font-medium my-3">
                          ─ 안 읽은 메시지 ─
                        </div>
                      )}

                      <div
                        className={`flex gap-3 ${
                          mine ? "justify-end" : ""
                        }`}
                      >
                        {!mine && (
                          <img
                            src={writer?.avatar_url || "/default-avatar.png"}
                            alt=""
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover bg-slate-200 shrink-0 shadow-sm"
                          />
                        )}

                        <div
                          className={`flex max-w-[82%] flex-col sm:max-w-[70%] ${
                            mine ? "items-end text-right" : "items-start"
                          }`}
                        >
                          {!mine && (
                            <p className="text-sm font-semibold mb-1 text-slate-700">
                              {writer?.display_name ?? "알 수 없음"}
                            </p>
                          )}

                          <div
                            className={`inline-block w-fit max-w-full rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words ${
                              mine
                                ? "bg-indigo-600 text-white rounded-tr-md"
                                : "bg-slate-100 text-slate-900 rounded-tl-md"
                            }`}
                          >
                            {renderReplyPreview(m, mine)}
                            {m.content && (
                              <div>{renderTextWithLinksAndEmojis(m.content, customEmojis)}</div>
                            )}
                            {renderMedia(m)}
                          </div>

                          <div
                            className={`mt-1 flex w-fit max-w-full items-center gap-1 ${
                              mine ? "self-end justify-end" : "self-start justify-start"
                            }`}
                          >
                            {renderReactions(m.id)}
                            {renderReactionPicker(m)}
                          </div>

                          <div
                            className={`mt-1 flex w-fit max-w-full gap-2 text-xs text-slate-400 ${
                              mine ? "self-end justify-end" : "self-start justify-start"
                            }`}
                          >
                            <span>
                              읽음 {readCount}/{currentRoomMemberCount} ·{" "}
                              {formatTime(m.created_at)}
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReplyTo(m);
                              }}
                              className="rounded-full border border-indigo-100 bg-white px-2 py-0.5 text-xs text-indigo-600 shadow-sm hover:bg-indigo-50"
                            >
                              답장
                            </button>
                          </div>
                        </div>

                        {mine && (
                          <img
                            src={
                              (userMap.get(me.id)?.avatar_url ??
                                me.avatar_url) || "/default-avatar.png"
                            }
                            alt=""
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover bg-slate-200 shrink-0 shadow-sm"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                <div ref={bottomRef} />
              </div>

              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-4 py-2 shadow-lg z-50"
                >
                  ↓ 최신 메시지
                </button>
              )}
            </div>

            <div className="shrink-0 p-2 sm:p-4 border-t border-indigo-100 bg-indigo-50/70">
              {replyTo && (
                <div className="mb-2 flex items-center justify-between rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-indigo-600 font-semibold mb-1">
                      {userMap.get(replyTo.user_id)?.display_name ?? "메시지"}
                      에게 답장
                    </p>
                    <p className="truncate text-slate-500">
                      {replyTo.content || replyTo.media_name || "미디어"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="text-slate-400 hover:text-slate-900"
                  >
                    ×
                  </button>
                </div>
              )}

              {pendingFiles.length > 0 && (
                <div className="mb-3 flex gap-2 overflow-x-auto">
                  {pendingFiles.map((file, index) => {
                    const previewUrl = URL.createObjectURL(file);

                    return (
                      <div
                        key={`${file.name}-${index}`}
                        className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl border bg-white overflow-hidden shrink-0"
                      >
                        {file.type.startsWith("image/") ? (
                          <img
                            src={previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : file.type.startsWith("video/") ? (
                          <video
                            src={previewUrl}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="p-2 text-xs break-all">
                            📎 {file.name}
                          </div>
                        )}

                        <button
                          onClick={() =>
                            setPendingFiles((prev) =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {showEmojiSuggest && customEmojis.length > 0 && (
                <div className="mb-2 max-h-44 overflow-y-auto rounded-2xl border border-indigo-100 bg-white p-2 shadow-lg">
                  {customEmojis
                    .filter((emoji) => emoji.name.includes(emojiQuery))
                    .slice(0, 12)
                    .map((emoji) => (
                      <button
                        key={emoji.id}
                        type="button"
                        onClick={() => insertEmoji(emoji.name)}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-indigo-50"
                      >
                        <img
                          src={emoji.image_url}
                          alt={emoji.name}
                          className="h-6 w-6 rounded object-contain"
                        />
                        <span>:{emoji.name}:</span>
                      </button>
                    ))}
                </div>
              )}

              <div className="flex gap-2 bg-white border border-indigo-100 rounded-2xl p-2 shadow-sm">
                <label className="cursor-pointer px-3 py-3 rounded-xl hover:bg-indigo-50">
                  📎
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setPendingFiles((prev) => [...prev, ...files]);
                      e.target.value = "";
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowEmojiSuggest((v) => !v)}
                  className="px-3 py-3 rounded-xl hover:bg-indigo-50"
                  title="이모티콘"
                >
                  ::
                </button>

                <input
                  value={content}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContent(value);

                    const match = value.match(/:([a-zA-Z0-9_가-힣-]*)$/);
                    if (match) {
                      setEmojiQuery(match[1]);
                      setShowEmojiSuggest(true);
                    } else {
                      setEmojiQuery("");
                      setShowEmojiSuggest(false);
                    }
                  }}
                  onFocus={markMessagesAsRead}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={
                    selectedRoom === "group"
                      ? "전체방에 보낼 업무 내용을 입력하세요"
                      : "개인 메시지를 입력하세요"
                  }
                  className="flex-1 px-3 sm:px-4 py-3 outline-none text-sm min-w-0"
                />

                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl px-4 sm:px-6 transition"
                >
                  등록
                </button>
              </div>
            </div>
          </div>

          <aside className="order-first lg:order-last max-h-[180px] lg:max-h-none min-h-0 bg-indigo-50/50 p-3 sm:p-4 overflow-y-auto border-b lg:border-b-0">
            <h2 className="font-bold mb-3 text-sm text-slate-900">채팅방</h2>

            <button
              onClick={() => {
                setSelectedRoom("group");
                isNearBottomRef.current = true;
                setReplyTo(null);
              }}
              className={`w-full mb-3 text-left rounded-2xl p-3 border transition ${
                selectedRoom === "group"
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white border-indigo-100 hover:bg-indigo-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>전체방</span>

                {getUnreadCount("group") > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                    {getUnreadCount("group")}
                  </span>
                )}
              </div>
            </button>

            <div className="space-y-2 mb-6">
              {activeUsers
                .filter((u) => u.id !== me.id)
                .map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setSelectedRoom(u.id);
                      isNearBottomRef.current = true;
                      setReplyTo(null);
                    }}
                    className={`w-full flex items-center gap-3 rounded-2xl p-3 border transition ${
                      selectedRoom === u.id
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white border-indigo-100 hover:bg-indigo-50"
                    }`}
                  >
                    <div className="relative">
                      <img
                        src={u.avatar_url || "/default-avatar.png"}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover bg-slate-200"
                      />
                      <span
                        className={`absolute right-0 bottom-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          isActuallyOnline(u, onlineIds)
                            ? "bg-emerald-500"
                            : "bg-slate-300"
                        }`}
                      />
                    </div>

                    <span className="text-sm font-medium truncate">
                      {u.display_name}
                    </span>

                    {getUnreadCount(u.id) > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                        {getUnreadCount(u.id)}
                      </span>
                    )}
                  </button>
                ))}
            </div>

            <h2 className="font-bold mb-4 text-sm text-slate-900">
              담당자 현황
            </h2>

            <div className="space-y-3">
              {activeUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 bg-white border border-indigo-100 rounded-2xl p-3"
                >
                  <div className="relative">
                    <img
                      src={u.avatar_url || "/default-avatar.png"}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover bg-slate-200"
                    />
                    <span
                      className={`absolute right-0 bottom-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                        isActuallyOnline(u, onlineIds)
                          ? "bg-emerald-500"
                          : "bg-slate-300"
                      }`}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {u.display_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {isActuallyOnline(u, onlineIds) ? "접속 중" : "오프라인"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>

      {opacity === 0 && (
        <button
          onClick={() => setOpacity(100)}
          className="fixed bottom-4 right-4 bg-indigo-600 text-white rounded-full px-4 py-2 shadow-xl z-[9999]"
        >
          투명도 복구
        </button>
      )}
    </main>
  );
}
