import Image from "next/image";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { LoginFormClient } from "./login-form-client";
import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const LOGIN_IMAGE_EXTENSIONS = /\.(avif|webp|png|jpe?g|gif|svg)$/i;
const LOGIN_IMAGE_BUCKET = "empresa";
const LOGIN_IMAGE_FOLDER = "images/login";

async function urlExiste(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) return true;

    // Alguns servidores não suportam HEAD
    if (head.status === 405) {
      const get = await fetch(url, { method: "GET", cache: "no-store" });
      return get.ok;
    }

    return false;
  } catch {
    return false;
  }
}

async function fetchPrimeiraImagemLogin() {
  const { data: files, error } = await supabaseAdmin.storage
    .from(LOGIN_IMAGE_BUCKET)
    .list(LOGIN_IMAGE_FOLDER, {
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

  if (error) {
    console.error("Erro ao listar imagens de login no Supabase:", error);
    return null;
  }

  const firstImage = (files ?? []).find((file) => {
    const name = String(file.name ?? "").trim();
    const mimeType = String(file.metadata?.mimetype ?? "").toLowerCase();
    return name !== ".emptyFolderPlaceholder"
      && (mimeType.startsWith("image/") || LOGIN_IMAGE_EXTENSIONS.test(name));
  });

  if (!firstImage) return null;

  const { data } = supabaseAdmin.storage
    .from(LOGIN_IMAGE_BUCKET)
    .getPublicUrl(`${LOGIN_IMAGE_FOLDER}/${firstImage.name}`);

  return data.publicUrl || null;
}

export async function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  // ✅ fallback local SOMENTE para background
  // Coloque em: /public/images/login-fallback.jpg
  const bgFallback = "/images/login-fallback.jpg";

  // Decide TUDO no server (sem swap no client)
  const [finalLogo, bgSupabase] = await Promise.all([
    fetchPrimeiroLogoEmpresa(),
    fetchPrimeiraImagemLogin(),
  ]);

  const bgOk = bgSupabase ? await urlExiste(bgSupabase) : false;
  const finalBg = bgOk && bgSupabase ? bgSupabase : bgFallback;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          {/* Esquerda: client component (form + forgot dialog) */}
          <LoginFormClient turnstileSiteKey={turnstileSiteKey} />

          {/* Direita: server component (imagens já decididas) */}
          <div className="bg-muted relative hidden overflow-hidden md:block group">
            {/* Logo: SEM fallback — só aparece se existir */}
            {finalLogo && (
              <div className="w-full absolute z-20 h-full flex p-6 justify-center">
                <Image
                  width={480}
                  height={480}
                  src={finalLogo}
                  alt="logo"
                  className="absolute object-cover w-[120px] opacity-85 group-hover:opacity-95 transition-all"
                  priority
                  sizes="(min-width: 768px) 120px, 0px"
                />
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-b from-blue-800/50 to-cyan-300/10 z-10" />

            {/* Background: Supabase OU fallback (já decidido no server) */}
            <Image
              width={720}
              height={720}
              src={finalBg}
              alt="imagem_login"
              className="absolute h-full w-full object-cover scale-110"
              priority
              sizes="(min-width: 768px) 50vw, 0vw"
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-muted-foreground text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4">
        Ao continuar você concorda com os <a href="#">Termos de Serviço</a> e a{" "}
        <a href="#">Política de Privacidade</a>.
      </div>
    </div>
  );
}
