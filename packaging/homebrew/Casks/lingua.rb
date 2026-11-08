cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "2.2.0"
  sha256 arm:   "de78619627c8af4e966ebd1b729ea8b9938d3a84d5b48bcf96abf65cc9a25bac",
         intel: "138f359805fe470f61d114cdb30c18b83c0011640777e22b441172b0520429dd"

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
