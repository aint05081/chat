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

type Message = {
  id: number;
  user_id: number;
  content: string;
  created_at: string;
  read_by?: number[] | null;
  users?: User;
};

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

export default function Home() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineIds, setOnlineIds] = useState<number[]>([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");

  const [adminOpen, setAdminOpen] = useState(false);
  const [bossMode, setBossMode] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = me?.role === "admin";

  const activeUsers = useMemo(
    () => users.filter((u) => u.is_active !== false),
    [users]
  );

  const onlineUsers = useMemo(
    () => activeUsers.filter((u) => isActuallyOnline(u, onlineIds)),
    [activeUsers, onlineIds]
  );

  useEffect(() => {
    const saved = localStorage.getItem("work-log-user");
    if (saved) setMe(JSON.parse(saved));

    loadUsers();
    loadMessages();

    const messagesChannel = supabase
      .channel("messages-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => loadMessages()
      )
      .subscribe();

    const usersChannel = supabase
      .channel("users-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "users" },
        () => {
          loadUsers();
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(usersChannel);
    };
  }, []);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
        setBossMode((v) => !v);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function loadUsers() {
    const { data } = await supabase
      .from("users")
      .select("*")
      .order("id", { ascending: true });

    setUsers(data ?? []);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from("messages")
      .select("*, users(*)")
      .order("created_at", { ascending: true })
      .limit(300);

    setMessages(data ?? []);
  }

  async function markMessagesAsRead() {
    if (!me) return;

    const unreadMessages = messages.filter((m) => {
      const readBy = m.read_by ?? [];
      return !readBy.includes(me.id);
    });

    for (const message of unreadMessages) {
      const nextReadBy = Array.from(
        new Set([...(message.read_by ?? []), me.id])
      );

      await supabase
        .from("messages")
        .update({ read_by: nextReadBy })
        .eq("id", message.id);
    }

    await loadMessages();
  }

  async function login() {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim())
      .eq("password", password.trim())
      .single();

    if (error || !data) {
      alert("이메일 또는 비밀번호가 틀렸어.");
      return;
    }

    if (data.is_active === false) {
      alert("비활성화된 계정이야.");
      return;
    }

    setMe(data);
    localStorage.setItem("work-log-user", JSON.stringify(data));
  }

  function logout() {
    setMe(null);
    setAdminOpen(false);
    localStorage.removeItem("work-log-user");
  }

  async function sendMessage() {
    if (!me || !content.trim()) return;

    const { error } = await supabase.from("messages").insert({
      user_id: me.id,
      content: content.trim(),
      read_by: [me.id],
    });

    if (error) {
      alert("메시지 전송 실패: " + error.message);
      return;
    }

    setContent("");
    await loadMessages();
  }

  async function updateDisplayName(userId: number, displayName: string) {
    if (!isAdmin || !displayName.trim()) return;

    const { error } = await supabase
      .from("users")
      .update({ display_name: displayName.trim() })
      .eq("id", userId);

    if (error) {
      alert("이름 변경 실패: " + error.message);
      return;
    }

    await loadUsers();
    await loadMessages();

    if (me?.id === userId) {
      const updatedMe = { ...me, display_name: displayName.trim() };
      setMe(updatedMe);
      localStorage.setItem("work-log-user", JSON.stringify(updatedMe));
    }
  }

  async function updatePassword(userId: number, newPasswordValue: string) {
    if (!isAdmin || !newPasswordValue.trim()) return;

    const { error } = await supabase
      .from("users")
      .update({ password: newPasswordValue.trim() })
      .eq("id", userId);

    if (error) {
      alert("비밀번호 변경 실패: " + error.message);
      return;
    }

    await loadUsers();
  }

  async function toggleActive(user: User) {
    if (!isAdmin) return;

    if (user.role === "admin") {
      alert("관리자 계정은 비활성화하지 않는 게 좋아.");
      return;
    }

    await supabase
      .from("users")
      .update({ is_active: user.is_active === false ? true : false })
      .eq("id", user.id);

    await loadUsers();
  }

  async function deleteUser(user: User) {
    if (!isAdmin) return;

    if (user.role === "admin") {
      alert("관리자 계정은 삭제하지 마.");
      return;
    }

    const ok = confirm(`${user.display_name} 계정을 삭제할까?`);
    if (!ok) return;

    await supabase.from("users").delete().eq("id", user.id);
    await loadUsers();
    await loadMessages();
  }

  async function addUser() {
    if (!isAdmin) return;

    if (!newEmail.trim() || !newPassword.trim() || !newName.trim()) {
      alert("이메일, 비밀번호, 표시명을 모두 입력해.");
      return;
    }

    const { error } = await supabase.from("users").insert({
      email: newEmail.trim(),
      password: newPassword.trim(),
      display_name: newName.trim(),
      role: "member",
      is_active: true,
    });

    if (error) {
      alert("멤버 추가 실패: " + error.message);
      return;
    }

    setNewEmail("");
    setNewPassword("");
    setNewName("");
    await loadUsers();
  }

  async function uploadAvatar(file: File) {
    if (!me) return;

    const fileExt = file.name.split(".").pop();
    const filePath = `${me.id}/avatar.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert("이미지 업로드 실패: " + uploadError.message);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: avatarUrl })
      .eq("id", me.id);

    if (updateError) {
      alert("DB 저장 실패: " + updateError.message);
      return;
    }

    const updatedMe = { ...me, avatar_url: avatarUrl };
    setMe(updatedMe);
    localStorage.setItem("work-log-user", JSON.stringify(updatedMe));

    await loadUsers();
    await loadMessages();
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
              if (e.key === "Enter") login();
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
                콘텐츠 마케팅 팀 현황 공유
              </h1>
              <p className="text-sm text-slate-500">
                Ctrl + Shift + B로 원래 화면으로 돌아가기
              </p>
            </div>
            <button
              onClick={() => setBossMode(false)}
              className="bg-white border border-indigo-100 px-4 py-2 rounded-xl shadow-sm"
            >
              업무 할당 보기
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
              <p className="text-sm text-slate-500">오늘 기록</p>
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
                        검수/수정
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
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6 overflow-hidden">
      <div className="max-w-6xl mx-auto h-[calc(100vh-48px)] bg-white/95 backdrop-blur border border-indigo-100 rounded-3xl shadow-xl overflow-hidden flex flex-col">
        <header className="h-[76px] flex justify-between items-center px-6 border-b border-indigo-100 bg-gradient-to-r from-white to-indigo-50 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              콘텐츠 마케팅 업무 현황
            </h1>
            <p className="text-sm text-slate-500">
              광고 소재 / 검수 / 수정 요청 기록
            </p>
          </div>

          <div className="flex gap-3 items-center">
            <div className="text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-full">
              접속 중 {onlineUsers.length}명
            </div>

            <label className="cursor-pointer">
              <img
                src={me.avatar_url || "/default-avatar.png"}
                alt=""
                className="w-10 h-10 rounded-full object-cover bg-slate-200 border-2 border-white shadow"
                title="프로필 사진 변경"
              />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAvatar(file);
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

            <div className="bg-white border border-indigo-100 rounded-2xl p-4 mb-4 grid grid-cols-[1fr_1fr_1fr_100px] gap-3">
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
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm transition"
              >
                추가
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className={`bg-white border border-indigo-100 rounded-2xl p-4 grid grid-cols-[70px_1.4fr_1fr_1fr_90px_120px] gap-3 items-center ${
                    u.is_active === false ? "opacity-40" : ""
                  }`}
                >
                  <div className="relative">
                    <img
                      src={u.avatar_url || "/default-avatar.png"}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover bg-slate-200"
                    />
                    <span
                      className={`absolute right-1 bottom-1 w-3 h-3 rounded-full border-2 border-white ${
                        isActuallyOnline(u, onlineIds)
                          ? "bg-emerald-500"
                          : "bg-slate-300"
                      }`}
                    />
                  </div>

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

        <section className="flex-1 min-h-0 grid grid-cols-[1fr_240px]">
          <div className="min-h-0 flex flex-col border-r border-indigo-100">
            <div
              onClick={markMessagesAsRead}
              className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 bg-white"
            >
              {messages.map((m) => {
                const mine = m.user_id === me.id;
                const readCount = m.read_by?.length ?? 0;

                return (
                  <div
                    key={m.id}
                    className={`flex gap-3 ${mine ? "justify-end" : ""}`}
                  >
                    {!mine && (
                      <img
                        src={m.users?.avatar_url || "/default-avatar.png"}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover bg-slate-200 shrink-0 shadow-sm"
                      />
                    )}

                    <div
                      className={`max-w-[70%] ${
                        mine ? "items-end text-right" : ""
                      }`}
                    >
                      {!mine && (
                        <p className="text-sm font-semibold mb-1 text-slate-700">
                          {m.users?.display_name ?? "알 수 없음"}
                        </p>
                      )}

                      <div
                        className={`rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${
                          mine
                            ? "bg-indigo-600 text-white rounded-tr-md"
                            : "bg-slate-100 text-slate-900 rounded-tl-md"
                        }`}
                      >
                        {m.content}
                      </div>

                      <p className="text-xs text-slate-400 mt-1">
                        읽음 {readCount}/{activeUsers.length} ·{" "}
                        {formatTime(m.created_at)}
                      </p>
                    </div>

                    {mine && (
                      <img
                        src={me.avatar_url || "/default-avatar.png"}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover bg-slate-200 shrink-0 shadow-sm"
                      />
                    )}
                  </div>
                );
              })}

              <div ref={bottomRef} />
            </div>

            <div className="shrink-0 p-4 border-t border-indigo-100 bg-indigo-50/70">
              <div className="flex gap-2 bg-white border border-indigo-100 rounded-2xl p-2 shadow-sm">
                <input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onFocus={markMessagesAsRead}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendMessage();
                  }}
                  placeholder="업무 내용을 입력하세요"
                  className="flex-1 px-4 py-3 outline-none text-sm"
                />

                <button
                  onClick={sendMessage}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 transition"
                >
                  등록
                </button>
              </div>
            </div>
          </div>

          <aside className="min-h-0 bg-indigo-50/50 p-4 overflow-y-auto">
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
    </main>
  );
}