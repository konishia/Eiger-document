// 文中の URL（FAQ の出典など）をタップできるリンクにする

const URL_PATTERN = /(https?:\/\/[^\s）)」]+)/g;

export default function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="link break-all">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
