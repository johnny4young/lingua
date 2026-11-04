cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "2.0.0"
  sha256 arm:   "207d7d6af98728465e067525903fae9c1389e7354db9feeda6e3b518ef9ed8a8",
         intel: "1c429d3e2ea07eb21e5510acd9ba4046c1bb02513be665e1807baf6e53870bf8"

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
