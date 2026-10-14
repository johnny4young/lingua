cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.6.0"
  sha256 arm:   "6f3f3effd2aa463847ef95eda420a6244fb98bba38f0fd55e7c326a68f12faa9",
         intel: "fb241f99359639e09fcee006c4c9caa10e34a586aa12fd621689062c6d06fe43"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :ventura

  app "lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
