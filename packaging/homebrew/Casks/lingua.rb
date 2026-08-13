cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.3.0"
  sha256 arm:   "0546eec170a9e247cd9a6da66227bf8d5fc9ffafe3279572442c18baf6ff8a46",
         intel: "500c7510d56edae546688a522d4d387113e1efd97cc647b0a459971c54a41be9"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg",
      verified: "github.com/johnny4young/lingua/"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :monterey

  app "lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
