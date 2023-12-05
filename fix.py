output = ""
words = ["Tempo", "Valence", "Liveness", "Instrumentalness", "Acousticness", "Speechiness", "Mode", "MusicKey", "Energy", "Danceability", "Duration", "Popularity"]

for word in words:
    output += "<label>\n"
    output += "\t<% if (cssm." + word.lower() + " == \"true\") { %>\n"
    output +=  "\t\t<input type=\"checkbox\" id=\"" + word.lower() + "\" name=\"" + word.lower() + "\" checked /> " + word + "\n"
    output += "\t<% } else { %>\n"
    output +=  "\t\t<input type=\"checkbox\" id=\"" + word.lower() + "\" name=\"" + word.lower() + "\" /> " + word + "\n"
    output += "\t<% } %>\n"
    output += "</label>\n"

print(output)