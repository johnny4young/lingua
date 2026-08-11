cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.1.0"
  sha256 arm:   "51cf0c00540b99f6f0fcae18089275c79dcc6b7eac62db534948c39a71db837f",
         intel: "8d6754a17774b5880697975446fb000cc63734cccb52370819e75adfc019fac2"

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
