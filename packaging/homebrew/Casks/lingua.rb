cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.6.1"
  sha256 arm:   "3acf2b4dad7d75b8077abfbfad3daff7f9976bfbfa66615bc33c43a4adbcfe7d",
         intel: "6d26186d438912bb1034552435236504c47bb03abe561655437e9de4c5963a86"

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
